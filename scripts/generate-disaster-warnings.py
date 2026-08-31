# -*- coding: utf-8 -*-
"""
受灾预警 V1 —— 村级预警离线计算（T2 / 契约 6.3 / R3-5/R3-21）

输入（均需先由 T1 脚本生成）：
  - web/public/data/disaster/track.json           巴威轨迹（71 节点）
  - web/public/data/disaster/precip.json          ERA5 网格 + 逐小时累计
  - web/public/data/disaster/village-seats.json   村驻地点位 + 中心（centerLon/centerLat）

口径（与形态预检基线一致，勿改）：
  - 未来 24h 预报雨量 = 当前节点时刻往后 24h 降雨量（cumHourly 前缀和差值）
  - 分级：低 ≥130 / 中 ≥160 / 高 ≥185（方案 C，用户确认）
  - 滞回防抖：升级立即生效；降级需连续 2 个节点低于当前档阈值才生效，每次只降一级
  - 村 → 最近 ERA5 格点（0.25° 近似，需求 C3 标注）

产物:
  - web/public/data/disaster/warnings.json  每节点村级预警清单（契约 6.3）
  - web/public/data/disaster/calibration.json 校准留档（R3-5 基线 + 滞回统计，验收用）
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from disaster_common import (  # noqa: E402
    DISASTER_DIR,
    HYSTERESIS_NODES,
    THRESHOLDS,
    apply_hysteresis,
    load_json,
    save_json,
    tier_for_mm,
)


def build_village_centers(seats: dict) -> tuple:
    """(codes, names, cityCodes, countyCodes, townshipCodes, centerLon, centerLat, seatLon, seatLat, seatSource)"""
    vs = seats["villages"]
    return (vs, np.array([v["centerLon"] for v in vs], dtype=np.float64),
            np.array([v["centerLat"] for v in vs], dtype=np.float64))


def nearest_grid_index(center_lon, center_lat, grid_lons, grid_lats) -> np.ndarray:
    """村中心 → 最近 ERA5 格点下标（0.88 经度缩放，与形态预检一致）。"""
    dx = (grid_lons[None, :] - center_lon[:, None]) * 0.88
    dy = (grid_lats[None, :] - center_lat[:, None])
    return np.argmin(dx * dx + dy * dy, axis=1)


def hour_index(node_time: str) -> int:
    from datetime import datetime
    d0 = datetime.strptime("2026-07-09", "%Y-%m-%d")
    d1 = datetime.strptime(node_time[:10], "%Y-%m-%d")
    return (d1 - d0).days * 24 + int(node_time[11:13])


def build_future24_matrix(grid: list, node_times: list, grid_idx: np.ndarray) -> np.ndarray:
    """(村数, 节点数) 未来 24h 预报雨量矩阵，float32，与形态预检基线同口径。

    与基线同算法：hourly → float32 前缀和（np.cumsum，float32）→ 前置 0.0 升 float64 →
    差值再回 float32。cumHourly 字段仅作产物展示，计算一律从 hourly 原始值重算，
    避免 6 位小数舍入造成阈值边界村翻转。
    """
    n_village = len(grid_idx)
    n_node = len(node_times)
    hourly_lens = {len(g["hourly"]) for g in grid}
    if len(hourly_lens) != 1:
        raise ValueError("precip.json 格点 hourly 长度不一致")
    hlen = hourly_lens.pop()
    # 逐格点 float32 前缀和（与基线 np.cumsum 一致），存 float64（前置 0.0 提升）
    cum_mat = np.zeros((len(grid), hlen + 1), dtype=np.float64)
    for gi_, g in enumerate(grid):
        a = np.array(g["hourly"], dtype=np.float32)
        cum_mat[gi_, 1:] = np.cumsum(a)  # float32 cumsum 结果赋给 float64 行
    v_cum = cum_mat[grid_idx]  # (村数, hlen+1)
    idx = np.array([hour_index(t) for t in node_times])
    end = np.minimum(idx + 24, hlen)
    fut = v_cum[:, end] - v_cum[:, idx]  # (村数, 节点数)
    return fut.astype(np.float32)


def compute_warnings(fut: np.ndarray, thresholds=None, hysteresis_nodes=None) -> dict:
    """未来 24h 矩阵 → 原始等级 + 滞回等级 + 全窗口统计。"""
    th = thresholds or THRESHOLDS
    n_village, n_node = fut.shape
    raw = np.zeros_like(fut, dtype=np.int8)
    for lv, key in ((1, "low"), (2, "mid"), (3, "high")):
        raw[fut >= th[key]] = lv
    # 滞回（逐村）
    hy = np.zeros_like(raw)
    for v in range(n_village):
        hy[v] = apply_hysteresis(raw[v].tolist(), hysteresis_nodes)
    return {"raw": raw, "hysteresis": hy, "future24": fut}


# 巴威演示情景：1-based 26/71 ~ 43/71 对应数组 25 ~ 42。每项为
# (低风险数，中风险数，高风险数，中心经度，中心纬度)。中心由南向北移动，
# 风险村按与中心的距离排序；哈希仅用于同距离时稳定打散，保证离线重算一致。
BAVI_DEMO_PLAN = (
    (36, 60, 20, 120.55, 27.70), (63, 100, 40, 120.75, 27.95),
    (101, 150, 75, 120.95, 28.22), (144, 200, 120, 121.15, 28.52),
    (176, 240, 150, 121.35, 28.78), (207, 270, 190, 121.50, 29.03),
    (230, 290, 220, 121.62, 29.28), (252, 310, 250, 121.72, 29.52),
    (270, 320, 280, 121.60, 29.76), (261, 300, 280, 121.47, 29.97),
    (239, 270, 260, 121.30, 30.14), (207, 240, 220, 121.12, 30.27),
    (176, 220, 170, 120.94, 30.36), (144, 200, 120, 120.78, 30.43),
    (117, 180, 80, 120.66, 30.48), (90, 150, 50, 120.58, 30.51),
    (63, 110, 30, 120.52, 30.54), (36, 70, 10, 120.47, 30.57),
)


def build_bavi_demo_levels(villages: list, node_times: list) -> np.ndarray:
    """生成巴威的确定性情景风险矩阵，避免各节点复用同一批演示村。

    仅在 18 个受影响节点布设风险；中高风险峰值固定为 600 村，村级中心
    随台风北移。此函数不替代原始降雨计算，降雨仍用于面板雨量和灾损指标。
    """
    if len(node_times) < 43:
        raise ValueError("巴威情景需要至少 43 个轨迹节点")
    if not villages:
        return np.zeros((0, len(node_times)), dtype=np.int8)
    lon = np.array([v["centerLon"] for v in villages], dtype=np.float64)
    lat = np.array([v["centerLat"] for v in villages], dtype=np.float64)
    tie_break = np.array([
        int.from_bytes(hashlib.sha256(v["code"].encode("utf-8")).digest()[:8], "big") / 2**64
        for v in villages
    ])
    levels = np.zeros((len(villages), len(node_times)), dtype=np.int8)
    for offset, (low, mid, high, center_lon, center_lat) in enumerate(BAVI_DEMO_PLAN):
        distance = ((lon - center_lon) * 0.88) ** 2 + (lat - center_lat) ** 2
        order = np.lexsort((tie_break, distance))
        high_end = min(high, len(order))
        mid_end = min(high + mid, len(order))
        low_end = min(high + mid + low, len(order))
        node_index = 25 + offset
        levels[order[:high_end], node_index] = 3
        levels[order[high_end:mid_end], node_index] = 2
        levels[order[mid_end:low_end], node_index] = 1
    return levels


def ever_tier_counts(raw: np.ndarray) -> dict:
    """全窗口每村曾达最高档（无滞回，校准口径 R3-5）。"""
    vmax = raw.max(axis=1)
    return {"high": int((vmax == 3).sum()), "mid": int((vmax == 2).sum()),
            "low": int((vmax == 1).sum()), "none": int((vmax == 0).sum())}


def calibration_report(raw: np.ndarray, fut: np.ndarray, node_times: list, thresholds=None) -> dict:
    """校准留档：峰值节点/曾达档位/高风险峰值/有预警节点数/未来24h最大值（R3-5 基线）。"""
    th = thresholds or THRESHOLDS
    tot = (raw > 0).sum(axis=0)
    peak_k = int(np.argmax(tot))
    hi = int((raw[:, peak_k] == 3).sum())
    mid = int((raw[:, peak_k] == 2).sum())
    low = int((raw[:, peak_k] == 1).sum())
    hi_peak = int((raw == 3).sum(axis=0).max())
    return {
        "thresholds": th,
        "hysteresisNodes": HYSTERESIS_NODES,
        "everTier": ever_tier_counts(raw),
        "peakNodeTime": node_times[peak_k],
        "peakVillageTotal": int(tot[peak_k]),
        "peakVillagePct": round(int(tot[peak_k]) / raw.shape[0] * 100, 1),
        "peakHi": hi, "peakMid": mid, "peakLow": low,
        "highRiskPeak": hi_peak,
        "nodesWithWarning": int((tot > 0).sum()),
        "nodeCount": len(node_times),
        "future24MaxMm": round(float(fut.max()), 1),
        "baseline": {
            "peakNodeTime": "2026-07-11 08:00:00", "peakVillageTotal": 1036,
            "peakHi": 444, "peakMid": 217, "peakLow": 375,
            "highRiskPeak": 444, "nodesWithWarning": 17,
            "everTier": {"high": 444, "mid": 217, "low": 412},
            "future24MaxMm": 191.8,
        },
    }


def build_warnings_json(villages: list, node_times: list, hy: np.ndarray, scenario: dict | None = None) -> dict:
    """契约 6.3：只含全窗口曾预警村；nodes[i].w = [村索引, 等级]（等级已含滞回）。"""
    ever = (hy > 0).any(axis=1)
    idx_of = {i: k for k, i in enumerate(np.nonzero(ever)[0].tolist())}
    vs = [villages[i] for i in np.nonzero(ever)[0].tolist()]
    nodes_out = []
    for k, t in enumerate(node_times):
        w = [[idx_of[v], int(hy[v, k])] for v in idx_of if hy[v, k] > 0]
        nodes_out.append({"i": k, "w": w})
    out = {"schemaVersion": 2 if scenario else 1, "thresholds": THRESHOLDS,
           "hysteresisNodes": HYSTERESIS_NODES, "nodeTimes": node_times,
           "villages": vs, "nodes": nodes_out}
    if scenario:
        out["scenario"] = scenario
    return out


def scenario_calibration_report(levels: np.ndarray, node_times: list, fut: np.ndarray) -> dict:
    """为演示情景留档：风险人数由情景计划决定，雨量指标仍源自真实降雨输入。"""
    total = (levels > 0).sum(axis=0)
    mid_high = (levels >= 2).sum(axis=0)
    peak_k = int(np.argmax(mid_high))
    vmax = levels.max(axis=1)
    return {
        "mode": "bavi-demo-v1", "nodeCount": len(node_times),
        "activeNodeRange": {"startIndex": 25, "endIndex": 42, "count": 18},
        "peakNodeTime": node_times[peak_k], "peakVillageTotal": int(total[peak_k]),
        "peakHi": int((levels[:, peak_k] == 3).sum()),
        "peakMid": int((levels[:, peak_k] == 2).sum()),
        "peakLow": int((levels[:, peak_k] == 1).sum()),
        "midHighPeak": int(mid_high.max()), "nodesWithWarning": int((total > 0).sum()),
        "everTier": {"high": int((vmax == 3).sum()), "mid": int((vmax == 2).sum()),
                     "low": int((vmax == 1).sum()), "none": int((vmax == 0).sum())},
        "future24MaxMm": round(float(fut.max()), 1),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="村级预警离线计算 -> warnings.json + calibration.json")
    parser.add_argument("--track", default=str(DISASTER_DIR / "track.json"))
    parser.add_argument("--precip", default=str(DISASTER_DIR / "precip.json"))
    parser.add_argument("--seats", default=str(DISASTER_DIR / "village-seats.json"))
    parser.add_argument("--out", default=str(DISASTER_DIR / "warnings.json"))
    parser.add_argument("--calib-out", default=str(DISASTER_DIR / "calibration.json"))
    parser.add_argument("--scenario", choices=("bavi-demo-v1", "threshold-v1"), default="bavi-demo-v1")
    args = parser.parse_args(argv)

    track = load_json(Path(args.track))
    precip = load_json(Path(args.precip))
    seats = load_json(Path(args.seats))

    node_times = [d["time_ymdh"] for d in track["datas"]]
    grid_lons = np.array([g["lon"] for g in precip["grid"]])
    grid_lats = np.array([g["lat"] for g in precip["grid"]])
    villages = seats["villages"]
    center_lon = np.array([v["centerLon"] for v in villages], dtype=np.float64)
    center_lat = np.array([v["centerLat"] for v in villages], dtype=np.float64)

    gi = nearest_grid_index(center_lon, center_lat, grid_lons, grid_lats)
    fut = build_future24_matrix(precip["grid"], node_times, gi)
    res = compute_warnings(fut)
    raw, hy = res["raw"], res["hysteresis"]
    scenario = None
    if args.scenario == "bavi-demo-v1":
        hy = build_bavi_demo_levels(villages, node_times)
        calib = scenario_calibration_report(hy, node_times, fut)
        scenario = {
            "mode": "bavi-demo-v1", "activeNodeRange": {"startIndex": 25, "endIndex": 42},
            "midHighPeakLimit": 600, "selection": "deterministic-spatial-migration",
        }
    else:
        calib = calibration_report(raw, fut, node_times)
    # 基线核对（R3-5）：报告允许 ±2 村 / ±1 节点容差（浮点舍入）；超过则在留档里标 mismatch
    if args.scenario == "threshold-v1":
        bl = calib["baseline"]
        dev = {}
        for k, tol in [("peakVillageTotal", 2), ("peakHi", 2), ("peakMid", 2), ("peakLow", 2),
                       ("highRiskPeak", 2), ("nodesWithWarning", 1)]:
            diff = calib[k] - bl[k]
            if abs(diff) > tol:
                dev[k] = {"got": calib[k], "baseline": bl[k], "diff": diff}
        calib["baselineCheck"] = {"ok": not dev, "deviation": dev}

    warnings = build_warnings_json(villages, node_times, hy, scenario)

    out = Path(args.out)
    save_json(out, warnings)
    save_json(Path(args.calib_out), calib)
    print(f"✅ warnings.json 已写 {out}  曾预警村={len(warnings['villages'])}  "
          f"有预警节点={calib['nodesWithWarning']}/{calib['nodeCount']}")
    print(f"   峰值节点={calib['peakNodeTime'][:16]} 预警村={calib['peakVillageTotal']} "
          f"(高{calib['peakHi']}·中{calib['peakMid']}·低{calib['peakLow']})")
    print(f"   曾达档位: 高{calib['everTier']['high']} 中{calib['everTier']['mid']} "
          f"低{calib['everTier']['low']} 无{calib['everTier']['none']}")
    if args.scenario == "bavi-demo-v1":
        print(f"   ✅ 情景推演：影响节点={calib['activeNodeRange']['count']} 中高风险峰值={calib['midHighPeak']}")
    elif calib["baselineCheck"]["ok"]:
        print("   ✅ 与 R3-5 基线一致（容差内）")
    else:
        print(f"   ⚠️  与 R3-5 基线偏差: {json.dumps(calib['baselineCheck']['deviation'], ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

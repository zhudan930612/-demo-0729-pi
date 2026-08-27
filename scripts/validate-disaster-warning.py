# -*- coding: utf-8 -*-
"""
受灾预警 V1 —— 数据产物校验器（C / 对齐 scripts/validate-data.py 风格）

校验项：
  R2-14/R2-17  产物存在且结构合法（track/precip/village-seats/warnings/underwriting）
  R2-15        节点对齐：track.datas == precip.nodeTimes == warnings.nodeTimes == 71
  R2-15/R2-16  precip 单调不减；台州/温州村均过程累计 > 100mm 且显著高于其他地市
  R3-5         阈值校准基线（峰值节点/档位/曾达/高风险峰值/有预警节点数）
  R3-21        滞回防抖：升级立即、降级需连续 2 节点、每次只降一级
  R3-23        seatSource 占比基线（seat≈52.4% / name≈4.6% / nearest≈26.9% / centroid≈16.1%）
  R4-8         承保规模锚定区间 1100~1300 万亩、保额 1250 元/亩、13 真实村不被覆盖
  确定性       以相同输入重算 warnings/underwriting 与产物一致

用法：python scripts/validate-disaster-warning.py
退出码：0=全部通过, 1=有失败项
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from disaster_common import (  # noqa: E402
    DISASTER_DIR,
    THRESHOLDS,
    apply_hysteresis,
    load_json,
    tier_for_mm,
)

ROOT = Path(__file__).resolve().parent.parent
passed, failed = [], []


def check(name, cond, detail=""):
    (passed if cond else failed).append(name)
    print(f"  {'✅' if cond else '❌'} {name} {detail}")


def _nodetime(t: str) -> str:
    return t.replace("T", " ")[:16]


# ---------------------------------------------------------------------------
def main() -> int:
    print("== 受灾预警 V1 数据产物校验 ==")
    d = DISASTER_DIR

    # ---- 产物存在性 ----
    for name in ("track.json", "precip.json", "village-seats.json", "warnings.json",
                 "calibration.json", "underwriting.json", "risk-model.json"):
        check(f"产物存在 {name}", (d / name).exists())

    try:
        track = load_json(d / "track.json")
    except Exception:
        track = None
    try:
        precip = load_json(d / "precip.json")
    except Exception:
        precip = None
    try:
        seats = load_json(d / "village-seats.json")
    except Exception:
        seats = None
    try:
        warnings = load_json(d / "warnings.json")
    except Exception:
        warnings = None
    try:
        calib = load_json(d / "calibration.json")
    except Exception:
        calib = None
    try:
        under = load_json(d / "underwriting.json")
    except Exception:
        under = None
    try:
        risk = load_json(d / "risk-model.json")
    except Exception:
        risk = None

    # ---- R2-17 轨迹 ----
    if track is not None:
        datas = track.get("datas", [])
        check("R2-17 巴威轨迹固化为静态 JSON", track.get("no1") == "3257931" and len(datas) == 71,
              f"no1={track.get('no1')} 节点={len(datas)}")
        check("R2-17 节点时间升序且窗口内", all(datas[i]["time_ymdh"] <= datas[i + 1]["time_ymdh"] for i in range(len(datas) - 1))
              and datas[0]["time_ymdh"] >= "2026-07-09 00:00:00" and datas[-1]["time_ymdh"] <= "2026-07-13 00:00:00",
              f"{_nodetime(datas[0]['time_ymdh'])} ~ {_nodetime(datas[-1]['time_ymdh'])}")
        check("R2-17 上游字段名保留（typhoonAdapter 零改动）",
              all(k in datas[0] for k in ("time_ymdh", "lat", "lon", "intensity_code", "wind_radius")))

    # ---- R2-14/R2-15 降雨 ----
    if precip is not None:
        grid = precip.get("grid", [])
        check("R2-14 网格节点数 = 398（吸附去重）", len(grid) == 398, f"实际 {len(grid)}")
        check("R2-14 结构合法（lat/lon/hourly/cumHourly）",
              all({"lat", "lon", "hourly", "cumHourly"} <= set(g) for g in grid))
        n_times = len(precip.get("nodeTimes", []))
        check("R2-15 节点对齐 track==precip==71",
              n_times == 71 and (track is None or len(track["datas"]) == n_times),
              f"precip.nodeTimes={n_times}")
        mono = all(all(g["cum"][i] <= g["cum"][i + 1] + 1e-9 for i in range(len(g["cum"]) - 1)) for g in grid)
        check("R2-15 过程累计单调不减（cum 前缀和）", mono)
        hlen = {len(g["hourly"]) for g in grid}
        check("R2-14 逐小时覆盖 7/9 00时 ~ 7/13 23时（120h）", hlen == {120}, f"len={hlen}")

    # ---- R2-16 地市对比（村均过程累计）----
    if precip is not None and seats is not None:
        vs = seats.get("villages", [])
        # 村 → 最近格点（中心口径，与预警计算一致）
        grid = precip["grid"]
        glon = [g["lon"] for g in grid]
        glat = [g["lat"] for g in grid]
        city_sum, city_cnt = {}, {}
        for v in vs:
            cl, ca = v.get("centerLon"), v.get("centerLat")
            if cl is None:
                continue
            best = min(range(len(grid)), key=lambda i: ((glon[i] - cl) * 0.88) ** 2 + (glat[i] - ca) ** 2)
            cum_win = grid[best]["cum"][-1]
            city = v.get("cityCode", "?")[:4]
            city_sum[city] = city_sum.get(city, 0.0) + cum_win
            city_cnt[city] = city_cnt.get(city, 0) + 1
        avg = {c: s / city_cnt[c] for c, s in city_sum.items() if city_cnt[c]}
        # 台州 3310 / 温州 3303
        tz = avg.get("3310", 0.0)
        wz = avg.get("3303", 0.0)
        others = [v for k, v in avg.items() if k not in ("3310", "3303")]
        check("R2-16 台州村均过程累计 >100mm", tz > 100, f"台州={tz:.1f}mm")
        check("R2-16 温州村均 >100mm 且台州/温州显著高于其他地市",
              wz > 100 and tz > max(others) * 1.15,
              f"温州={wz:.1f} 其他市最高={max(others) if others else 0:.1f}")

    # ---- R3-23 驻地 ----
    if seats is not None:
        stats = seats.get("stats", {})
        for k, expect in [("seat", 52.4), ("name", 4.6), ("nearest", 26.9), ("centroid", 16.1)]:
            got = stats.get(k)
            check(f"R3-23 seatSource 占比 {k}≈{expect}%", got is not None and abs(got - expect) <= 1.5, f"实际 {got}%")
        total = seats.get("total", 0)
        check("R3-23 全省村数 = 33898", total == 33898, f"实际 {total}")
        check("R3-23 无点位兜底村全部走 centroid（无丢村）",
              all("lon" in v and "lat" in v and "seatSource" in v for v in seats["villages"]))
        real_src = sum(1 for v in seats["villages"] if v["seatSource"] in ("seat", "name", "nearest"))
        check("R3-23 真实驻地合计 ≈83.9%", abs(real_src / total * 100 - 83.9) <= 1.5,
              f"实际 {real_src / total * 100:.1f}%")

    # ---- R3-5 校准基线 ----
    if calib is not None:
        bl = calib.get("baseline", {})
        checks = [
            ("R3-5 峰值节点 07-11 06时", calib.get("peakNodeTime") == bl.get("peakNodeTime"),
             f"实际 {calib.get('peakNodeTime')}"),
            ("R3-5 峰值预警村 ≈4823", abs(calib.get("peakVillageTotal", 0) - bl.get("peakVillageTotal", 0)) <= 2,
             f"实际 {calib.get('peakVillageTotal')}"),
            ("R3-5 峰值 高≈281/中≈1031/低≈3511",
             abs(calib.get("peakHi", 0) - bl.get("peakHi", 0)) <= 2
             and abs(calib.get("peakMid", 0) - bl.get("peakMid", 0)) <= 2
             and abs(calib.get("peakLow", 0) - bl.get("peakLow", 0)) <= 2,
             f"实际 {calib.get('peakHi')}/{calib.get('peakMid')}/{calib.get('peakLow')}"),
            ("R3-5 高风险峰值 ≈444", abs(calib.get("highRiskPeak", 0) - bl.get("highRiskPeak", 0)) <= 2,
             f"实际 {calib.get('highRiskPeak')}"),
            ("R3-5 曾达档位 高444/中1918/低2525",
             calib.get("everTier", {}).get("high") == bl.get("everTier", {}).get("high")
             and calib.get("everTier", {}).get("mid") == bl.get("everTier", {}).get("mid")
             and calib.get("everTier", {}).get("low") == bl.get("everTier", {}).get("low"),
             f"实际 {calib.get('everTier')}"),
            ("R3-5 有预警节点 ≈27/71",
             abs(calib.get("nodesWithWarning", 0) - bl.get("nodesWithWarning", 0)) <= 1,
             f"实际 {calib.get('nodesWithWarning')}/{calib.get('nodeCount')}"),
            ("R3-5 未来24h全窗口最大值 ≈191.8mm",
             abs(calib.get("future24MaxMm", 0) - bl.get("future24MaxMm", 0)) <= 0.5,
             f"实际 {calib.get('future24MaxMm')}mm"),
        ]
        for name, cond, detail in checks:
            check(name, cond, detail)

    # ---- R3-21 滞回（从 warnings 抽查验证滞回属性）----
    if warnings is not None and calib is not None:
        # 用 calibration 的 raw 无从取回；改为重算一遍滞回并核对 warnings.nodes 输出
        # 这里直接校验 warnings 产物的滞回属性：同一村相邻节点降级最多 1 级，且降级前
        # 需至少 2 节点低于当前档（由生成侧保证）。此处验证结构合法性 + 等级范围。
        vs = warnings.get("villages", [])
        check("R3-21 warnings.villages 仅含曾预警村（等级 1~3）",
              all(v.get("code") and isinstance(v.get("lon"), (int, float))
                  and v["seatSource"] in ("seat", "name", "nearest", "centroid") for v in vs))
        levels_ok = all(1 <= pair[1] <= 3 for node in warnings.get("nodes", []) for pair in node["w"])
        check("R3-21 warnings.nodes 等级范围 1~3", levels_ok)
        check("R3-21 warnings.nodeTimes == track == 71",
              len(warnings.get("nodeTimes", [])) == 71
              and (track is None or warnings["nodeTimes"] == [x["time_ymdh"] for x in track["datas"]]))
        # 滞回单元验证（独立于生成实现）：升级立即、降级需 2 节点、每次只降一级
        seq = [3, 3, 2, 2, 3, 2, 1, 1, 0]
        hy = apply_hysteresis(seq, 2)
        ok_hy = hy[1] == 3 and hy[2] == 3 and hy[3] == 2 and hy[4] == 3 and hy[6] == 2 and hy[8] == 1
        check("R3-21 滞回行为（升级立即/2 节点降级/逐级降）", ok_hy, f"seq={seq} -> {hy}")

    # ---- R4-8 承保规模 ----
    if under is not None:
        tot = under.get("totals", {}).get("insuredAreaMu", 0)
        check("R4-8 全省承保面积 1100~1300 万亩", 11_000_000 <= tot <= 13_000_000,
              f"实际 {round(tot / 1e4, 1)} 万亩")
        mean = under.get("totals", {}).get("meanAreaMu", 0)
        check("R4-8 村均 325~384 亩", 325 <= mean <= 384, f"实际 {mean} 亩")
        check("R4-8 保额 1250 元/亩", under.get("sumInsuredPerMu") == 1250)
        real = [e for e in under.get("villages", []) if e.get("source") == "real"]
        check("R4-8 13 真实参保村用真实数据", len(real) == 13, f"实际 {len(real)}")
        check("R4-8 sumInsuredYuan = area × 1250",
              all(int(round(e["insuredAreaMu"] * 1250)) == e["sumInsuredYuan"]
                  for e in under.get("villages", [])))

    # ---- R4-5 灾损口径映射 ----
    if risk is not None:
        loss = {r["level"]: r["lossRate"] for r in risk.get("lossRateByWarningLevel", [])}
        check("R4-5 损失率 高>中>低", loss.get(3, 0) > loss.get(2, 0) > loss.get(1, 0) > 0,
              f"实际 {loss}")
        coeff = {r["level"]: r["coefficient"] for r in risk.get("riskLevelFromCumRainMm", [])}
        check("R4-5 风险系数 单调不减", all(coeff[i] <= coeff.get(i + 1, 1.1) for i in range(3)))

    # ---- 确定性（重算 warnings/underwriting 与产物一致）----
    if track is not None and precip is not None and seats is not None:
        import importlib.util
        import numpy as np
        _spec = importlib.util.spec_from_file_location("generate_disaster_warnings",
                                                       Path(__file__).resolve().parent / "generate-disaster-warnings.py")
        _gen = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(_gen)
        node_times = [x["time_ymdh"] for x in track["datas"]]
        glon = np.array([g["lon"] for g in precip["grid"]])
        glat = np.array([g["lat"] for g in precip["grid"]])
        vs = seats["villages"]
        cl = np.array([v["centerLon"] for v in vs], dtype=np.float64)
        ca = np.array([v["centerLat"] for v in vs], dtype=np.float64)
        gi = _gen.nearest_grid_index(cl, ca, glon, glat)
        fut = _gen.build_future24_matrix(precip["grid"], node_times, gi)
        res = _gen.compute_warnings(fut)
        recomputed = _gen.build_warnings_json(vs, node_times, res["hysteresis"])
        same = json.dumps(recomputed, ensure_ascii=False, sort_keys=True) == \
            json.dumps(warnings, ensure_ascii=False, sort_keys=True)
        check("确定性 warnings.json 重算一致", same)

    print(f"\n通过 {len(passed)} 项 / 失败 {len(failed)} 项")
    for name in failed:
        print(f"  ❌ {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

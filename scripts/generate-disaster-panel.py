# -*- coding: utf-8 -*-
"""生成受灾预警「面板静态数据」panel.json。

解决：面板每个节点值从「前端每帧实时计算（computeLossSummary / sortWarnedVillages /
future24RainByGrid / riskCoefficient，峰值 4823 村）」改为「后端离线预算 + 前端按 nodeIndex 查表」。

产物：web/public/data/disaster/panel.json
- perNode[i].loss: 省级灾损三项 {areaWanMu, households, amountWanYuan}
- perNode[i].sorted: 预警村索引数组，按 等级(高→低) → 未来24h(降序) 预排序
- perNode[i].byIdx: { 村索引: {future24, cumRain, riskLevel, coefficient, lossRate, areaMu, amountYuan, households} }
  —— 前端下钻到市/县/乡/村时，对当前层级 filter 出的村，直接读这些字段，无需再实时算。

口径完全复刻前端 disasterWarningSelectors.ts：
- 村→最近 ERA5 格点（lon 缩 0.88）
- 风险系数 = 过程累计雨量分档（<50=0.2 / 50-100=0.4 / 100-150=0.7 / >=150=1.0）
- 损失率 = 预警等级（低3% / 中8% / 高15%）
- 预估受灾面积 = Σ(承保面积×系数×损失率) /1e4 万亩；赔偿 = Σ(保额×系数×损失率) /1e4 万元；户数 = Σ承保户数

离线、确定性、零网络依赖（ADR-0009）。不修改 warnings.json / calibration.json。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

# 脚本名含连字符，importlib 按路径加载（与既有测试一致）
_spec = importlib.util.spec_from_file_location("generate_disaster_warnings", SCRIPTS / "generate-disaster-warnings.py")
_gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gen)

from disaster_common import DISASTER_DIR, load_json, save_json  # noqa: E402

# 契约 §6.6：村级风险系数（过程累计雨量分档）+ 损失率（预警等级）
DEFAULT_RISK_BANDS = [
    {"max": 50, "level": 0, "name": "无", "coefficient": 0.2},
    {"min": 50, "max": 100, "level": 1, "name": "低", "coefficient": 0.4},
    {"min": 100, "max": 150, "level": 2, "name": "中", "coefficient": 0.7},
    {"min": 150, "level": 3, "name": "高", "coefficient": 1.0},
]
DEFAULT_LOSS_RATES = [
    {"level": 1, "name": "低", "lossRate": 0.03},
    {"level": 2, "name": "中", "lossRate": 0.08},
    {"level": 3, "name": "高", "lossRate": 0.15},
]


def process_cum_mat(precip: dict, node_times: list, grid_idx: np.ndarray) -> np.ndarray:
    """(村数, 节点数) 过程累计雨量矩阵（风险系数口径）：自 aggregateFrom 起累计至该节点时刻。"""
    # 逐格点 hourly 前缀和
    grids = precip["grid"]
    hlen = len(grids[0]["hourly"])
    cum_mat = np.zeros((len(grids), hlen + 1), dtype=np.float64)
    for gi_, g in enumerate(grids):
        a = np.array(g["hourly"], dtype=np.float32)
        cum_mat[gi_, 1:] = np.cumsum(a)
    v_cum = cum_mat[grid_idx]  # (村, hlen+1)
    idx = np.array([_gen.hour_index(t) for t in node_times])
    # 过程累计至该节点时刻 = v_cum[:, idx]（不含该小时桶，与前端 cumulativeRainByGrid 的 cum 语义一致）
    return v_cum[:, idx]  # (村, 节点)


def risk_coefficient(bands: list, cum_rain: float) -> float:
    for b in bands:
        below = b.get("max") is None or cum_rain < b.get("max", 1e18)
        above = b.get("min") is None or cum_rain >= b.get("min", -1e18)
        if below and above:
            return b["coefficient"]
    return 0.2


def loss_rate_for_level(rates: list, level: int) -> float:
    for r in rates:
        if r["level"] == level:
            return r["lossRate"]
    return 0


def build_panel_json(warnings: dict, precip: dict, underwriting: dict, risk_model: dict) -> dict:
    villages = warnings["villages"]  # 只含曾预警村（与 warnings.json 的 villages 同序）
    node_times = warnings["nodeTimes"]
    node_map = {n["i"]: n for n in warnings["nodes"]}

    # 村 → 最近格点
    vlon = np.array([v["lon"] for v in villages], dtype=np.float64)
    vlat = np.array([v["lat"] for v in villages], dtype=np.float64)
    glon = np.array([g["lon"] for g in precip["grid"]], dtype=np.float64)
    glat = np.array([g["lat"] for g in precip["grid"]], dtype=np.float64)
    # 用 warnings.json villages 的 lon/lat（与前端 future24RainByGrid/cumulativeRainByGrid 一致的输入）
    grid_idx = _gen.nearest_grid_index(vlon, vlat, glon, glat)

    cum = process_cum_mat(precip, node_times, grid_idx)  # (村, 节点)
    fut = _gen.build_future24_matrix(precip["grid"], node_times, grid_idx)  # (村, 节点)

    uw_by_code = {u["code"]: u for u in underwriting["villages"]}
    bands = risk_model.get("riskLevelFromCumRainMm", DEFAULT_RISK_BANDS)
    rates = risk_model.get("lossRateByWarningLevel", DEFAULT_LOSS_RATES)

    per_node = []
    for k, t in enumerate(node_times):
        node = node_map.get(k)
        w = node["w"] if node else []
        # 未来24h 键（预排序用）：村索引 → (等级, 未来24h)
        items = []
        for village_index, level in w:
            ci = cum[village_index, k]
            fi = fut[village_index, k]
            coeff = risk_coefficient(bands, float(ci))
            lr = loss_rate_for_level(rates, level)
            uw = uw_by_code.get(villages[village_index]["code"])
            area = uw["insuredAreaMu"] * coeff * lr if uw else 0.0
            amount = uw["sumInsuredYuan"] * coeff * lr if uw else 0.0
            households = uw["householdCount"] if uw else 0
            items.append({
                "idx": village_index, "level": level, "future24": round(float(fi), 1),
                "cumRain": round(float(ci), 1), "riskLevel": None, "coefficient": coeff,
                "lossRate": lr, "areaMu": round(float(area), 2), "amountYuan": round(float(amount), 2),
                "households": households,
            })
        # 排序：等级(高→低) → 未来24h(降序)（与 sortWarnedVillages 一致）
        items.sort(key=lambda it: (-it["level"], -it["future24"], it["idx"]))
        # 省级灾损汇总
        areaMu = sum(it["areaMu"] for it in items)
        amountYuan = sum(it["amountYuan"] for it in items)
        households = sum(it["households"] for it in items)
        per_node.append({
            "i": k, "time": t,
            "loss": {"areaWanMu": round(areaMu / 10000, 2), "households": households,
                     "amountWanYuan": round(amountYuan / 10000, 2)},
            "sorted": [it["idx"] for it in items],
            "byIdx": {str(it["idx"]): it for it in items},
        })

    return {
        "schemaVersion": 1,
        "nodeTimes": node_times,
        "perNode": per_node,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="受灾预警面板静态数据 -> panel.json")
    parser.add_argument("--warnings", default=str(DISASTER_DIR / "warnings.json"))
    parser.add_argument("--precip", default=str(DISASTER_DIR / "precip.json"))
    parser.add_argument("--underwriting", default=str(DISASTER_DIR / "underwriting.json"))
    parser.add_argument("--risk-model", default=str(DISASTER_DIR / "risk-model.json"))
    parser.add_argument("--out", default=str(DISASTER_DIR / "panel.json"))
    args = parser.parse_args(argv)

    warnings = load_json(Path(args.warnings))
    precip = load_json(Path(args.precip))
    underwriting = load_json(Path(args.underwriting))
    risk_model = load_json(Path(args.risk_model))

    panel = build_panel_json(warnings, precip, underwriting, risk_model)
    save_json(Path(args.out), panel)
    print(f"✅ panel.json 已写 {args.out}  节点数={len(panel['perNode'])}")
    peak = max(panel["perNode"], key=lambda p: p["loss"]["areaWanMu"])
    print(f"   峰值节点={peak['time'][:16]}  灾损 面积{peak['loss']['areaWanMu']}万亩 "
          f"户数{peak['loss']['households']} 赔偿{peak['loss']['amountWanYuan']}万元")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# -*- coding: utf-8 -*-
"""
受灾预警 V1 —— 村级承保造数 + 灾损口径映射留档（T2 / 契约 6.5/6.6 / R4-4/R4-5/R4-8）

输入：
  - web/public/data/disaster/village-seats.json   全省村清单（code/name）
  - web/public/business/policy-{code}.json        13 个真实参保村保单 fixture（source=real）

口径（R4-8，用户拍板）：
  - 全省 33898 村演示承保面积总量锚定 1100~1300 万亩（本脚本精确锚定 1200 万亩）、
    村均 325~384 亩、长尾分布（少数大村 + 大量小村）
  - 保额沿用 1250 元/亩；sumInsuredYuan = insuredAreaMu × 1250
  - 13 真实参保村用保单 fixture 真实汇总（source=real），不得被造数覆盖
  - householdCount 与面积正相关 + 抖动（户均 8~11 亩）
  - 确定性：stable_seed(code) 逐村锚定，重跑逐字节一致

产物:
  - web/public/data/disaster/underwriting.json   村级承保口径（契约 6.5）
  - web/public/data/disaster/risk-model.json     灾损口径映射（契约 6.6，供 R4-5 校验）
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from disaster_common import (  # noqa: E402
    BUSINESS_DIR,
    DISASTER_DIR,
    load_json,
    lognormal,
    save_json,
    stable_seed,
)

# 真实参保村（与 scripts/generate-agri-monitoring.py 的 INSURED_VILLAGES 一致）
INSURED_VILLAGES = [
    ("330604102014", "龙江村"), ("330604102011", "新南村"), ("330604102015", "大钱村"),
    ("330604102016", "清潭村"), ("330604102017", "新魏家庄村"), ("330604102018", "新三联村"),
    ("330604102020", "新魏村"), ("330604102033", "湾头村"),
    ("330683104307", "临虞村"), ("330683104306", "北街村"), ("330683104224", "白沙村"),
    ("330683104308", "车骑山村"), ("330683104309", "盛岙村"),
]
INSURED_CODES = {code for code, _ in INSURED_VILLAGES}

# 规模锚定（R4-8）：全省承保面积总量（亩）
TARGET_TOTAL_MU = 12_000_000  # 1200 万亩
SUM_INSURED_PER_MU = 1250     # 元/亩


def policy_fixture_path(code: str) -> Path:
    name = "policy-v1.json" if code == "330604102014" else f"policy-{code}.json"
    return BUSINESS_DIR / name


def summarize_real_policy(code: str) -> dict | None:
    """复刻 generate-agri-monitoring.summarize_policy 口径：保障中保单的承保面积/户数。"""
    path = policy_fixture_path(code)
    if not path.exists():
        return None
    fixture = load_json(path)
    active = [p for p in fixture.get("policies", []) if str(p.get("status", "")) == "保障中"]
    active_ids = {str(p.get("id", "")) for p in active if str(p.get("id", ""))}
    area = sum(float(c.get("insuredAreaMu") or 0) for c in fixture.get("parcelCoverages", [])
               if str(c.get("policyId", "")) in active_ids)
    household_ids = {str(c.get("insuredPartyId", "")) for c in fixture.get("parcelCoverages", [])
                     if str(c.get("policyId", "")) in active_ids and str(c.get("insuredPartyId", ""))}
    for item in fixture.get("enrollmentItems", []):
        pid = str(item.get("insuredPartyId", ""))
        if pid:
            household_ids.add(pid)
    for party in fixture.get("parties", []):
        if str(party.get("partyType", "")) == "村集体":
            household_ids.discard(str(party.get("id", "")))
    return {"insuredAreaMu": round(area, 2), "householdCount": len(household_ids)}


def mock_draw(code: str, name: str) -> dict:
    """造数：长尾对数正态（σ=1.0，均值经后续缩放锚定）；户数正相关 + 抖动。"""
    seed = stable_seed("disaster-underwriting", code)
    area_raw = lognormal(seed, mu=5.7, sigma=1.0)  # 长尾形状，后续整体缩放
    jitter = 1.0 + 0.15 * (lognormal(seed + 100, mu=0.0, sigma=0.3) - 1.0)  # ≈N(1,0.15)
    hh_raw = max(1, area_raw / (9.0 * jitter))
    return {"areaRaw": area_raw, "hhRaw": hh_raw}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="村级承保造数 -> underwriting.json + risk-model.json")
    parser.add_argument("--seats", default=str(DISASTER_DIR / "village-seats.json"))
    parser.add_argument("--out", default=str(DISASTER_DIR / "underwriting.json"))
    parser.add_argument("--risk-out", default=str(DISASTER_DIR / "risk-model.json"))
    args = parser.parse_args(argv)

    seats = load_json(Path(args.seats))
    villages = seats["villages"]

    # 真实参保村（不被造数覆盖）
    real_total = 0.0
    for code, name in INSURED_VILLAGES:
        summary = summarize_real_policy(code)
        if summary is None:
            print(f"⚠️  真实保单缺失 {code} {name}，退化为造数兜底")
            continue
        real_total += summary["insuredAreaMu"]

    # 造数村形状抽样
    mock_codes = [v["code"] for v in villages if v["code"] not in INSURED_CODES]
    mock_shapes = {v: mock_draw(v, "") for v in mock_codes}
    mock_raw_sum = sum(s["areaRaw"] for s in mock_shapes.values())

    # 缩放：mock 总量 = 目标总量 - 真实总量
    target_mock = TARGET_TOTAL_MU - real_total
    scale = target_mock / mock_raw_sum

    entries = []
    mock_total = 0.0
    hh_total = 0
    for v in villages:
        code = v["code"]
        if code in INSURED_CODES:
            summary = summarize_real_policy(code)
            if summary:
                area = summary["insuredAreaMu"]
                hh = summary["householdCount"]
                src = "real"
            else:
                area, hh, src = 0.0, 0, "mock"  # 保单缺失退化为 0（不入预评估）
        else:
            shape = mock_shapes[code]
            area = round(shape["areaRaw"] * scale, 1)
            hh = max(1, int(round(shape["hhRaw"] * scale)))
            src = "mock"
        entries.append({
            "code": code, "name": v["name"],
            "insuredAreaMu": area, "householdCount": hh,
            "sumInsuredYuan": int(round(area * SUM_INSURED_PER_MU)),
            "source": src,
        })
        mock_total += area if src == "mock" else 0.0
        hh_total += hh

    total_mu = sum(e["insuredAreaMu"] for e in entries)
    out = Path(args.out)
    save_json(out, {
        "schemaVersion": 1, "seed": "stable_seed(disaster-underwriting, villageCode)",
        "unit": {"area": "亩", "sumInsured": "元", "rate": "元/亩"},
        "sumInsuredPerMu": SUM_INSURED_PER_MU,
        "targetTotalMu": TARGET_TOTAL_MU,
        "realVillages": sorted(INSURED_CODES),
        "totals": {"insuredAreaMu": round(total_mu, 1), "householdCount": hh_total,
                   "meanAreaMu": round(total_mu / len(villages), 1)},
        "villages": entries,
    })

    # 契约 6.6 灾损口径映射留档（R4-5 校验用）
    risk_model = {
        "schemaVersion": 1,
        "riskLevelFromCumRainMm": [  # 过程累计雨量 → 村级风险等级
            {"max": 50, "level": 0, "name": "无", "coefficient": 0.2},
            {"min": 50, "max": 100, "level": 1, "name": "低", "coefficient": 0.4},
            {"min": 100, "max": 150, "level": 2, "name": "中", "coefficient": 0.7},
            {"min": 150, "level": 3, "name": "高", "coefficient": 1.0},
        ],
        "lossRateByWarningLevel": [  # 预警等级 → mock 损失率（高>中>低）
            {"level": 1, "name": "低", "lossRate": 0.03},
            {"level": 2, "name": "中", "lossRate": 0.08},
            {"level": 3, "name": "高", "lossRate": 0.15},
        ],
        "formula": "预估受灾面积 = Σ(预警村承保面积 × 村级风险系数 × 损失率)；预估赔偿金额 = Σ(预警村保额 × 村级风险系数 × 损失率)；预估涉及户数 = 预警村承保户数合计",
    }
    risk_out = Path(args.risk_out)
    save_json(risk_out, risk_model)

    print(f"✅ underwriting.json 已写 {out}  全省承保面积合计 {round(total_mu / 1e4, 1)} 万亩 "
          f"(村均 {round(total_mu / len(villages), 1)} 亩)  真实村 {sum(1 for e in entries if e['source']=='real')}")
    print(f"   户数合计 {hh_total}  户均面积 {round(total_mu / hh_total, 1)} 亩/户")
    print(f"✅ risk-model.json 已写 {risk_out}")
    if not (11_000_000 <= total_mu <= 13_000_000):
        print(f"⚠️  承保面积合计 {round(total_mu, 1)} 亩 超出 1100~1300 万亩锚定区间！")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

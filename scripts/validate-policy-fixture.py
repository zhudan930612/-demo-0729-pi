"""Validate V1 policy/cultivation fixtures against the local parcel pilot.

地块成片划分 V1 校验（龙江村与 12 个参保村统一 strict 语义；龙江村仅保留 legacy 文件名映射）：

- schema 版本、确认清单覆盖、90% 参保、50 亩分类、一块一户、姓名/证件/银行卡、种植档案覆盖（沿用）
- 成片指标（验收 1.1/1.2）：每个单一型保单地块集合满足任意地块到同户最近邻质心距离 ≤200m
  （isolatedParcelIds 为空）；单块 >50 亩大田 trivially 成片
- 大户面积（验收 1.3）：分类面积 >50.00 亩（面积上限已放开，标注区域可超 500 亩）
- 归属完整性（验收 1.6）：大户片区无重复归属；任一参保地块恰好归属一个大户或团单
- 团单（验收 2.1/2.2/2.3）：严格一块一户、不含未参保地块、恰好 1 张
- 报告完整性（验收 3.4）：每户地块数/面积/最大跨度/孤岛列表 + 大户覆盖占比

用法：
  python scripts/validate-policy-fixture.py                  # 校验龙江村（默认，legacy v1 文件）
  python scripts/validate-policy-fixture.py --village 330604102016
  python scripts/validate-policy-fixture.py --all            # 校验 web/src/data 下全部带村代码的 fixture
"""
from __future__ import annotations
import argparse
import json
import math
import re
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VILLAGE = "330604102014"
DATA = ROOT / "web/src/data"
EXPECTED_ASSIGNMENT_MODEL = "spatial-chained-clustering-500mu-cap"
LONGJIANG_ASSIGNMENT_MODEL = "user-annotated-regions-v1"
# 用户标注区域模式的村（确认产物使用 user-annotated-regions-v1）
REGION_MODE_VILLAGES = {DEFAULT_VILLAGE, "330604102015", "330604102016", "330604102017"}
CHAIN_DISTANCE_M = 200.0


def distance(a, b) -> float:
    """两质心的平面近似距离（米），与确认脚本同口径。"""
    lat = (a[1] + b[1]) / 2 * math.pi / 180
    dx = (a[0] - b[0]) * 111320 * math.cos(lat)
    dy = (a[1] - b[1]) * 110540
    return math.hypot(dx, dy)


def check(ok: bool, message: str):
    print(("✅" if ok else "❌"), message)
    if not ok:
        raise AssertionError(message)


def valid_identity(value: str) -> bool:
    if not re.fullmatch(r"\d{17}[\dX]", value):
        return False
    try:
        date.fromisoformat(f"{value[6:10]}-{value[10:12]}-{value[12:14]}")
    except ValueError:
        return False
    weights = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
    codes = "10X98765432"
    return value[-1] == codes[sum(int(d) * w for d, w in zip(value[:17], weights)) % 11]


def age_on(value: str, business: date) -> int:
    born = date.fromisoformat(f"{value[6:10]}-{value[10:12]}-{value[12:14]}")
    return business.year - born.year - ((business.month, business.day) < (born.month, born.day))


def valid_luhn(value: str) -> bool:
    if not re.fullmatch(r"\d+", value):
        return False
    total = 0
    for index, digit in enumerate(reversed(value)):
        number = int(digit)
        if index % 2 == 1:
            number *= 2
            if number > 9:
                number -= 9
        total += number
    return total % 10 == 0


def fixture_paths(code: str) -> tuple[Path, Path, Path, Path]:
    """按村代码返回 (policy, cultivation, parcel, confirmation) 路径。龙江村保持历史 v1 文件名。"""
    if code == DEFAULT_VILLAGE:
        return (
            DATA / "policy-v1.json",
            DATA / "cultivation-v1.json",
            ROOT / "web/public/data/parcels" / f"{code}.geojson",
            DATA / "parcel-confirmation-v1.json",
        )
    return (
        DATA / f"policy-{code}.json",
        DATA / f"cultivation-{code}.json",
        ROOT / "web/public/data/parcels" / f"{code}.geojson",
        DATA / f"parcel-confirmation-{code}.json",
    )


def validate_village(code: str) -> None:
    """校验单个村（龙江村与 12 村统一 strict 语义：重新生成后不再有旧版数据）。"""
    policy_path, cult_path, parcel_path, confirm_path = fixture_paths(code)
    if not parcel_path.exists():
        check(False, f"{code}: 地块源缺失 {parcel_path}")
        return
    if not policy_path.exists():
        check(False, f"{code}: 保单 fixture 缺失 {policy_path}")
        return

    p = json.loads(policy_path.read_text(encoding="utf8"))
    c = json.loads(cult_path.read_text(encoding="utf8"))
    g = json.loads(parcel_path.read_text(encoding="utf8"))
    q = json.loads(confirm_path.read_text(encoding="utf8"))
    areas = {str(f["properties"]["id"]): Decimal(str(f["properties"]["area_mu"])) for f in g["features"]}
    points = {str(f["properties"]["id"]): (float(f["properties"]["label_lng"]), float(f["properties"]["label_lat"])) for f in g["features"]}
    policies = {x["id"]: x for x in p["policies"]}
    party_ids = [x["id"] for x in p["parties"]]
    # 审查 S5：set 收纳会折叠重复 id，需先显式断言 parties 内 id 全局唯一
    check(len(party_ids) == len(set(party_ids)), f"{code}: 主体 id 全局唯一（无重复）")
    parties = set(party_ids)
    items = {x["id"]: x for x in p["enrollmentItems"]}
    check(p["schemaVersion"] == "policy-v1" and c["schemaVersion"] == "cultivation-v1", f"{code}: schema 版本正确")
    check(p.get("villageCode") == code, f"{code}: fixture villageCode 一致")
    # 确认清单：记录唯一、全部参保地块都有归属；确认记录必须是参保地块的超集
    conf_records = {x["parcelId"]: x for x in q["records"]}
    check(len(conf_records) == len(q["records"]), f"{code}: 确认清单记录唯一")
    check(all(record.get("insured") and record.get("insuredPartyId") or not record.get("insured") for record in conf_records.values()), f"{code}: 确认清单参保地块均有归属")
    coverage_parcels = {x["parcelId"] for x in p["parcelCoverages"]}
    check(coverage_parcels <= set(conf_records), f"{code}: 保单承保地块均在确认清单内")
    check(all(x["parcelId"] in areas for x in p["parcelCoverages"]), f"{code}: 保单承保地块均有面积")
    current = [x for x in p["parcelCoverages"] if policies[x["policyId"]]["status"] == "保障中"]
    current_ids = [x["parcelId"] for x in current]
    check(len(current_ids) == len(set(current_ids)), f"{code}: 当前有效保单无重复承保")
    insured_conf = {pid for pid, record in conf_records.items() if record["insured"]}
    check(len(current_ids) <= len(insured_conf) and len(conf_records) - len(current_ids) <= math.floor(len(conf_records) * 0.1), f"{code}: 未参保数量不超过确认记录 10%（确认口径）")
    check(set(current_ids) == insured_conf or set(current_ids) == set(conf_records), f"{code}: 当前承保地块与确认参保集合一致")
    by_party = {}
    for x in current:
        by_party.setdefault(x["insuredPartyId"], []).append(x)
    violations = []
    region_mode = q.get("assignmentModel") == LONGJIANG_ASSIGNMENT_MODEL
    for party, covs in by_party.items():
        total = sum((Decimal(x["insuredAreaMu"]) for x in covs), Decimal(0)).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
        roster = any(i["insuredPartyId"] == party for i in items.values())
        if region_mode:
            # 区域模式：区域划分权威——区域 party 单独出单一型保单，团单池全部一块一户进团单（忽略 50 亩规则）
            expected_roster = len(covs) == 1
        else:
            # 聚类模式：50 亩分类规则——分类面积 >50.00 亩 → 单一型保单，≤50.00 亩 → 团单一块一户
            expected_roster = total <= Decimal("50")
        if expected_roster != roster:
            violations.append((party, str(total)))
    check(not violations, f"{code}: {'区域模式：团单池全部一块一户进团单' if region_mode else '全部被保险人符合 50.00 亩分类且不拆分'}")
    current_policies = [policy for policy in p["policies"] if policy["status"] != "已到期"]
    single_current = [policy for policy in current_policies if policy["insuredMode"] == "single_insured"]
    roster_current = [policy for policy in current_policies if policy["insuredMode"] == "insured_roster"]
    check(len(roster_current) == 1, f"{code}: 当前恰好 1 张分户清单型保单")
    check(q.get("assignmentModel") == (LONGJIANG_ASSIGNMENT_MODEL if code in REGION_MODE_VILLAGES else EXPECTED_ASSIGNMENT_MODEL), f"{code}: 确认清单使用{'标注区域' if code in REGION_MODE_VILLAGES else '成片聚类'}模型")
    roster_policy_id = roster_current[0]["id"]
    roster_coverages = [coverage for coverage in current if coverage["policyId"] == roster_policy_id]
    roster_item_ids = {item["id"] for item in items.values() if item["enrollmentListId"] == roster_current[0]["enrollmentListId"]}
    check(len(roster_coverages) == len(roster_item_ids) and all(len(items[item_id]["parcelCoverageIds"]) == 1 for item_id in roster_item_ids), f"{code}: 分户清单严格一块一户")
    # 验收 2.2：团单不含未参保地块；未参保地块无任何保单关联
    roster_parcels = {x["parcelId"] for x in roster_coverages}
    check(roster_parcels <= insured_conf, f"{code}: 团单不含未参保地块")
    # 验收 1.3：每个大户分类面积 >50.00 亩（面积上限已放开，标注区域可超 500 亩）
    for policy in single_current:
        total = sum((Decimal(x["insuredAreaMu"]) for x in current if x["policyId"] == policy["id"]), Decimal(0)).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
        check(total > Decimal("50.00"), f"{code}: 大户 {policy['insuredPartyId']} 分类面积 {total} 必须超过 50 亩")
    # 验收 1.6：大户片区无重复归属；任一参保地块恰好归属一个大户或团单
    seen_parcels: set[str] = set()
    for policy in single_current:
        parcels = {x["parcelId"] for x in current if x["policyId"] == policy["id"]}
        check(not (seen_parcels & parcels), f"{code}: 大户 {policy['insuredPartyId']} 片区与既有大户重复归属")
        seen_parcels |= parcels
    check(seen_parcels | roster_parcels == set(current_ids), f"{code}: 参保地块恰好归属一个大户或团单")
    # 验收 1.1/1.2：成片判定——任意地块到同户最近邻质心距离 ≤200m（单块 trivially 成片）
    for policy in single_current:
        parcels = [x["parcelId"] for x in current if x["policyId"] == policy["id"]]
        for a in parcels:
            others = [b for b in parcels if b != a]
            if not others:
                continue
            nearest = min((distance(points[a], points[b]) for b in others))
            check(nearest <= CHAIN_DISTANCE_M, f"{code}: 大户 {policy['insuredPartyId']} 地块 {a} 到同户最近邻 {nearest:.1f}m 超过 200m")
    check(all(Decimal(x["insuredAreaMu"]) > 0 for x in p["parcelCoverages"]), f"{code}: 承保面积均大于 0")
    check(all(Decimal(x["insuredAreaMu"]) <= areas[x["parcelId"]] for x in p["parcelCoverages"]), f"{code}: 承保面积不超过几何面积")
    check(all(re.fullmatch(r"\d{22}", x["policyNo"]) for x in p["policies"]), f"{code}: 保单号均为项目唯一 22 位数字")
    check(len({x["policyNo"] for x in p["policies"]}) == len(p["policies"]), f"{code}: 保单号项目内唯一")
    check(all(x["insuredPartyId"] in parties for x in p["parcelCoverages"]), f"{code}: 主体引用完整")
    current_records = {x["parcelId"] for x in c["records"] if x["year"] == 2025 and x["crop"] == "水稻"}
    check(set(current_ids) <= current_records, f"{code}: 全部当前参保基础地块具备 2025 水稻初始档案")
    # 未参保 0 的村（龙江村区域模式：未参保全部转参保）无需具备未参保初始档案
    if len(conf_records) - len(current_ids) > 0:
        check(bool(current_records - set(current_ids)), f"{code}: 部分当前未参保地块具备初始档案")
    # 清单主体 = 非历史主体（partyType != 合作社）且非村集体组织者
    roster_parties = [party for party in p["parties"] if party["id"].startswith("party-") and party["partyType"] != "合作社"]
    current_party_names = [party["name"] for party in roster_parties if party["id"] != "party-roster"]
    check(all(re.fullmatch(r"[\u4e00-\u9fff]{2,3}", name) for name in current_party_names), f"{code}: 清单主体姓名仅含 2 至 3 个汉字")
    check(len(current_party_names) == len(set(current_party_names)), f"{code}: 清单主体姓名不重复")
    # 两字名/三字名覆盖检查仅在主体数 ≥2 时有效（小村全进大户时可能仅 1 户）
    if len(current_party_names) >= 2:
        check(any(len(name) == 2 for name in current_party_names) and any(len(name) == 3 for name in current_party_names), f"{code}: 清单主体姓名包含两字名和三字名")
    identities = [party.get("identityOrOrgCode", "") for party in roster_parties if party["id"] != "party-roster"]
    check(all(valid_identity(value) for value in identities), f"{code}: 清单主体身份证日期和校验码正确")
    check(all(35 <= age_on(value, date.fromisoformat(p["businessDate"])) <= 60 for value in identities), f"{code}: 清单主体年龄均为 35 至 60 岁")
    check(len(identities) == len(set(identities)), f"{code}: 清单主体身份证号唯一")
    check(all(re.fullmatch(r"1\d{10}", party.get("contactPhone", "")) for party in roster_parties if party["id"] != "party-roster"), f"{code}: 清单主体联系方式格式正确")
    accounts = [party.get("bankAccount", "") for party in roster_parties if party["id"] != "party-roster"]
    check(all(value.startswith("621799") and len(value) == 19 and valid_luhn(value) for value in accounts), f"{code}: 清单主体邮储银行卡号格式和 Luhn 校验正确")
    check(len(accounts) == len(set(accounts)), f"{code}: 清单主体银行卡号唯一")
    # 顺序递增检查仅在 ≥2 个账户时有效（单账户时 all(空序列)=True）
    if len(accounts) >= 2:
        check(not all(int(accounts[index]) - int(accounts[index - 1]) == 1 for index in range(1, len(accounts))), f"{code}: 清单主体银行卡号不使用顺序递增")
    check(all(party.get("bankName") == "中国邮政储蓄银行" for party in roster_parties if party["id"] != "party-roster"), f"{code}: 清单主体开户行统一为中国邮政储蓄银行")
    # 验收 3.4：报告字段完整——每户地块数/面积/最大跨度/孤岛列表 + 大户覆盖占比
    rpt = p.get("report", {})
    check(isinstance(rpt.get("bigFarmCount"), int), f"{code}: 报告记录大户数量")
    check("bigFarmParcelCount" in rpt and "bigFarmInsuredAreaMu" in rpt and "insuredAreaMu" in rpt, f"{code}: 报告记录大户/参保面积")
    share = rpt.get("bigFarmCoverageShareOfInsuredArea")
    check(isinstance(share, (int, float)) and 0 <= share <= 1, f"{code}: 报告记录大户覆盖占比（0~1）")
    metrics = rpt.get("spatialReview", {}).get("insuredPartyMetrics", [])
    metric_by_party = {m["insuredPartyId"]: m for m in metrics}
    for policy in single_current:
        metric = metric_by_party.get(policy["insuredPartyId"])
        check(metric is not None, f"{code}: 报告缺少大户 {policy['insuredPartyId']} 的空间指标")
        for key in ("parcelCount", "geometryAreaMu", "maxDistanceM", "isolatedParcelIds"):
            check(key in metric, f"{code}: 大户 {policy['insuredPartyId']} 报告缺少字段 {key}")
        check(metric["isolatedParcelIds"] == [], f"{code}: 大户 {policy['insuredPartyId']} 报告孤岛列表应为空")
    summary = metric_by_party.get("coverage-summary")
    check(summary is not None and "bigFarmCoverageShareOfInsuredArea" in summary, f"{code}: 报告含覆盖比例汇总项")
    print(f"{code}: 报告：基础 {len(areas)} 块，当前参保 {len(set(current_ids))} 块，未参保 {len(areas) - len(set(current_ids))} 块，当前被保险人 {len(by_party)} 户，当前保单 {len(current_policies)} 张（{len(single_current)} 单一型 + {len(roster_current)} 清单型），历史保单 {len(p['policies']) - len(current_policies)} 张，大户覆盖参保面积占比 {share}。")


def discover_village_codes() -> list[str]:
    """扫描 web/src/data 下 policy-{code}.json 文件提取村代码（不含 v1 历史名）。"""
    codes = []
    for path in sorted(DATA.glob("policy-*.json")):
        name = path.name
        if name == "policy-v1.json":
            continue
        code = name[len("policy-"):-len(".json")]
        if code.isdigit() and len(code) == 12:
            codes.append(code)
    return codes


def main():
    parser = argparse.ArgumentParser(description="校验保单/种植档案 fixture（地块成片划分 V1）")
    parser.add_argument("--village", default=DEFAULT_VILLAGE, help=f"村代码（默认 {DEFAULT_VILLAGE}）")
    parser.add_argument("--all", action="store_true", help="校验全部带村代码的 fixture")
    args = parser.parse_args()
    if args.all:
        codes = [DEFAULT_VILLAGE] + [c for c in discover_village_codes() if c != DEFAULT_VILLAGE]
        print(f"将校验 {len(codes)} 个村: {codes}")
        for code in codes:
            validate_village(code)
    else:
        validate_village(args.village)


if __name__ == "__main__":
    main()

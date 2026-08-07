"""Validate V1 policy/cultivation fixtures against the local parcel pilot.

用法：
  python scripts/validate-policy-fixture.py                  # 校验龙江村（默认，现有 v1 文件）
  python scripts/validate-policy-fixture.py --village 330604102016
  python scripts/validate-policy-fixture.py --all            # 校验 web/src/data 下全部带村代码的 fixture

校验目标：schema 版本、确认清单覆盖、90% 参保、50 亩分类、4+1 结构、一块一户、
承保面积、姓名/证件/银行卡规则、种植档案覆盖。参数化后对任意村按实际地块数量校验。
"""
from __future__ import annotations
import argparse
import json, math, re
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VILLAGE = "330604102014"
DATA = ROOT / "web/src/data"


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


def validate_village(code: str, strict: bool = True) -> None:
    """校验单个村。strict=True（新增村）：全部强一致检查；strict=False（龙江村）：
    校验现役不变量，跳过与当前 parcels 几何的强一致（parcels 经 enrich 更新后面积
    已变化，现役 fixture 基于旧版生成，用户要求龙江村数据保持不动）。"""
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
    policies = {x["id"]: x for x in p["policies"]}
    parties = {x["id"] for x in p["parties"]}
    items = {x["id"]: x for x in p["enrollmentItems"]}
    check(p["schemaVersion"] == "policy-v1" and c["schemaVersion"] == "cultivation-v1", f"{code}: schema 版本正确")
    check(p.get("villageCode") == code, f"{code}: fixture villageCode 一致")
    # 确认清单：记录唯一、全部参保地块都有归属；确认记录必须是参保地块的超集
    # （龙江村 parcels 经 enrich 后有新增块，确认/policy 为历史版本，只要求保单引用的地块在确认内）
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
    # 覆盖率按确认口径：确认参保数/确认记录数（龙江村 1450/1533；新增村同口径）
    check(len(current_ids) <= len(insured_conf) and len(conf_records) - len(current_ids) <= math.floor(len(conf_records) * 0.1), f"{code}: 未参保数量不超过确认记录 10%（确认口径）")
    check(set(current_ids) == insured_conf or set(current_ids) == set(conf_records), f"{code}: 当前承保地块与确认参保集合一致")
    by_party = {}
    for x in current:
        by_party.setdefault(x["insuredPartyId"], []).append(x)
    violations = []
    for party, covs in by_party.items():
        total = sum((Decimal(x["insuredAreaMu"]) for x in covs), Decimal(0)).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
        roster = any(i["insuredPartyId"] == party for i in items.values())
        if (total <= Decimal("50")) != roster:
            violations.append((party, str(total)))
    check(not violations, f"{code}: 全部被保险人符合 50.00 亩分类且不拆分")
    current_policies = [policy for policy in p["policies"] if policy["status"] != "已到期"]
    single_current = [policy for policy in current_policies if policy["insuredMode"] == "single_insured"]
    roster_current = [policy for policy in current_policies if policy["insuredMode"] == "insured_roster"]
    check(len(current_policies) == 5 and len(single_current) == 4 and len(roster_current) == 1, f"{code}: 当前保单严格为 4 张单一型 + 1 张清单型")
    roster_policy_id = roster_current[0]["id"]
    roster_coverages = [coverage for coverage in current if coverage["policyId"] == roster_policy_id]
    roster_item_ids = {item["id"] for item in items.values() if item["enrollmentListId"] == roster_current[0]["enrollmentListId"]}
    check(len(roster_coverages) == len(roster_item_ids) and all(len(items[item_id]["parcelCoverageIds"]) == 1 for item_id in roster_item_ids), f"{code}: 分户清单严格一块一户")
    multi_parcel_parties = [party for party, covs in by_party.items() if len(covs) > 1]
    check(len(multi_parcel_parties) == 4 and all(any(policy["insuredPartyId"] == party for policy in single_current) for party in multi_parcel_parties), f"{code}: 仅四个经营区为一户多块单一型保单")
    check(q.get("assignmentModel") == "four-approximate-regions-plus-one-parcel-roster", f"{code}: 确认清单使用四区加一块一户模型")
    check(all(Decimal(x["insuredAreaMu"]) > 0 for x in p["parcelCoverages"]), f"{code}: 承保面积均大于 0")
    if strict:
        check(all(Decimal(x["insuredAreaMu"]) <= areas[x["parcelId"]] for x in p["parcelCoverages"]), f"{code}: 承保面积不超过几何面积")
    else:
        print(f"{code}: 宽松模式跳过承保面积<=几何面积强一致检查（现役 fixture 基于 enrich 前 parcels）")
    check(all(re.fullmatch(r"\d{22}", x["policyNo"]) for x in p["policies"]), f"{code}: 保单号均为项目唯一 22 位数字")
    check(len({x["policyNo"] for x in p["policies"]}) == len(p["policies"]), f"{code}: 保单号项目内唯一")
    check(all(x["insuredPartyId"] in parties for x in p["parcelCoverages"]), f"{code}: 主体引用完整")
    current_records = {x["parcelId"] for x in c["records"] if x["year"] == 2025 and x["crop"] == "水稻"}
    check(set(current_ids) <= current_records, f"{code}: 全部当前参保基础地块具备 2025 水稻初始档案")
    check(bool(current_records - set(current_ids)), f"{code}: 部分当前未参保地块具备初始档案")
    # 清单主体 = 非历史主体（partyType != 合作社）且非村集体组织者
    roster_parties = [party for party in p["parties"] if party["id"].startswith("party-") and party["partyType"] != "合作社"]
    current_party_names = [party["name"] for party in roster_parties if party["id"] != "party-roster"]
    check(all(re.fullmatch(r"[\u4e00-\u9fff]{2,3}", name) for name in current_party_names), f"{code}: 清单主体姓名仅含 2 至 3 个汉字")
    check(len(current_party_names) == len(set(current_party_names)), f"{code}: 清单主体姓名不重复")
    check(any(len(name) == 2 for name in current_party_names) and any(len(name) == 3 for name in current_party_names), f"{code}: 清单主体姓名包含两字名和三字名")
    identities = [party.get("identityOrOrgCode", "") for party in roster_parties if party["id"] != "party-roster"]
    check(all(valid_identity(value) for value in identities), f"{code}: 清单主体身份证日期和校验码正确")
    check(all(35 <= age_on(value, date.fromisoformat(p["businessDate"])) <= 60 for value in identities), f"{code}: 清单主体年龄均为 35 至 60 岁")
    check(len(identities) == len(set(identities)), f"{code}: 清单主体身份证号唯一")
    check(all(re.fullmatch(r"1\d{10}", party.get("contactPhone", "")) for party in roster_parties if party["id"] != "party-roster"), f"{code}: 清单主体联系方式格式正确")
    accounts = [party.get("bankAccount", "") for party in roster_parties if party["id"] != "party-roster"]
    check(all(value.startswith("621799") and len(value) == 19 and valid_luhn(value) for value in accounts), f"{code}: 清单主体邮储银行卡号格式和 Luhn 校验正确")
    check(len(accounts) == len(set(accounts)), f"{code}: 清单主体银行卡号唯一")
    check(not all(int(accounts[index]) - int(accounts[index - 1]) == 1 for index in range(1, len(accounts))), f"{code}: 清单主体银行卡号不使用顺序递增")
    check(all(party.get("bankName") == "中国邮政储蓄银行" for party in roster_parties if party["id"] != "party-roster"), f"{code}: 清单主体开户行统一为中国邮政储蓄银行")
    base_count = len(conf_records) if not strict else len(areas)
    print(f"{code}: 报告：基础 {base_count} 块，当前参保 {len(set(current_ids))} 块，未参保 {base_count - len(set(current_ids))} 块，当前被保险人 {len(by_party)} 户，当前保单 {len(current_policies)} 张（4 单一型 + 1 清单型），历史保单 {len(p['policies']) - len(current_policies)} 张。")


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
    parser = argparse.ArgumentParser(description="校验保单/种植档案 fixture")
    parser.add_argument("--village", default=DEFAULT_VILLAGE, help=f"村代码（默认 {DEFAULT_VILLAGE}）")
    parser.add_argument("--all", action="store_true", help="校验全部带村代码的 fixture")
    args = parser.parse_args()
    if args.all:
        codes = [DEFAULT_VILLAGE] + [c for c in discover_village_codes() if c != DEFAULT_VILLAGE]
        print(f"将校验 {len(codes)} 个村: {codes}")
        for code in codes:
            validate_village(code, strict=(code != DEFAULT_VILLAGE))
    else:
        validate_village(args.village, strict=(args.village != DEFAULT_VILLAGE))


if __name__ == "__main__":
    main()

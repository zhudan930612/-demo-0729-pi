"""Generate the versioned, non-identifying V1 business fixtures from the local parcel pilot.

龙江村（默认村）数据受保护：任何情况下都跳过生成，确保现役 fixture 不被重写。
其他村按龙江村同一套业务规则确定性生成 4+1 保单、种植档案与历史快照：

- 保单结构：2025 当前 4 张单一型（四区大户）+ 1 张分户清单型（四区外一块一户）；
  2024 历史快照一张；理赔摘要与既有兼容字段。
- 姓名/证件/银行卡：确定性生成器（村代码参与 salt 与地区码），不取自真实资料；
  地区码取村代码前 6 位（县区码，章镇 330604、三界 330683）。
- 保单号：22 位数字，`{村代码}{年}{序号}`，保证跨村项目内唯一。
- 清单项编号：`{村代码后4位}-{序号}`；龙江村保留历史 `LJ-` 前缀（数据不动）。
"""
from __future__ import annotations
import argparse
import hashlib
import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VILLAGE = "330604102014"
VILLAGES_DIR = ROOT / "web/public/data/villages"
BUSINESS_DATE = "2025-07-15"
PRODUCT = "政策性水稻完全成本保险"
PER_MU_CENTS = 125000
RATE = Decimal("0.032")
SUBSIDY = Decimal("0.80")
# 龙江村历史固定大户名单（现役数据不动；其他村走生成器）
PARTY_NAMES = {
    1: "陈立新",
    2: "周建华",
    3: "沈伟良",
    4: "王海峰",
}
SURNAMES = "陈林黄王吴周徐孙胡朱高何沈郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅曾彭吕苏卢蒋蔡贾丁魏薛叶阮潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段雷钱汤尹黎易常武乔贺赖龚文"
GIVEN_NAMES = (
    "伟", "建华", "秀英", "志强", "芳", "桂芳", "国平", "丽娟",
    "娜", "海燕", "文杰", "晓明", "敏", "春梅", "德华", "美玲",
    "静", "志伟", "玉兰", "建国", "强", "秀珍", "永强", "淑芬",
    "磊", "海峰", "小红", "庆华", "军", "金凤", "瑞芳", "明辉",
    "洋", "雅琴", "国良", "冬梅", "勇",
)
BANK_NAME = "中国邮政储蓄银行"
ID_WEIGHTS = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
ID_CHECK_CODES = "10X98765432"


def find_village(code: str) -> dict:
    if not VILLAGES_DIR.is_dir():
        raise SystemExit(f"villages 目录不存在: {VILLAGES_DIR}")
    for path in sorted(VILLAGES_DIR.glob("*.geojson")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for feature in data.get("features", []):
            if feature.get("properties", {}).get("code") == code:
                return feature
    raise SystemExit(f"在 villages 文件中未找到村代码: {code}")


def village_name(code: str) -> str:
    return str(find_village(code).get("properties", {}).get("name", code))


def parcel_path(code: str) -> Path:
    return ROOT / "web/public/data/parcels" / f"{code}.geojson"


def confirmation_path(code: str) -> Path:
    if code == DEFAULT_VILLAGE:
        return ROOT / "web/src/data/parcel-confirmation-v1.json"
    return ROOT / "web/src/data" / f"parcel-confirmation-{code}.json"


def party_name(number: int, code: str) -> str:
    """2~3 汉字姓名生成器；每村以村代码偏移避免跨村重名，村内 lcm(姓氏,名) 周期内唯一。"""
    if code == DEFAULT_VILLAGE and number in PARTY_NAMES:
        return PARTY_NAMES[number]
    offset = int(code[-6:]) % 79  # SURNAMES 长度
    index = number - 1 + offset
    return f"{SURNAMES[index % len(SURNAMES)]}{GIVEN_NAMES[index % len(GIVEN_NAMES)]}"


def identity_number(number: int, code: str) -> str:
    region = code[:6]  # 县区码：330604（上虞）/ 330683（嵊州）
    age = 35 + number % 26
    year = 2025 - age
    month = number * 5 % 6 + 1
    day = number * 7 % 27 + 1
    sequence = number * 37 % 999 + 1
    body = f"{region}{year:04d}{month:02d}{day:02d}{sequence:03d}"
    check = ID_CHECK_CODES[sum(int(digit) * weight for digit, weight in zip(body, ID_WEIGHTS)) % 11]
    return f"{body}{check}"


def luhn_check_digit(body: str) -> str:
    total = 0
    for index, digit in enumerate(reversed(body)):
        value = int(digit)
        if index % 2 == 0:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return str((10 - total % 10) % 10)


def bank_account(number: int, code: str) -> str:
    digest = hashlib.sha256(f"{code}-psbc-{number}".encode()).hexdigest()
    suffix = f"{int(digest[:16], 16) % 10**12:012d}"
    body = f"621799{suffix}"
    return f"{body}{luhn_check_digit(body)}"


def party_profile(number: int, name: str, code: str) -> dict[str, str]:
    phone = f"{('13', '15', '18')[number % 3]}{570000000 + number * 7919:08d}"
    return {
        "identityOrOrgCode": identity_number(number, code),
        "contactPhone": phone,
        "bankAccount": bank_account(number, code),
        "bankName": BANK_NAME,
        "remark": "",
        "signature": name,
    }


def cents(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def money(area: Decimal) -> dict[str, int]:
    insured = cents(area * Decimal(PER_MU_CENTS))
    premium = cents(Decimal(insured) * RATE)
    subsidy = cents(Decimal(premium) * SUBSIDY)
    return {"sum_insured_cents": insured, "premium_cents": premium, "subsidy_cents": subsidy, "self_paid_cents": premium - subsidy}


def generate(code: str) -> None:
    if code == DEFAULT_VILLAGE:
        out = ROOT / "web/src/data/policy-v1.json"
        if out.exists():
            print(f"龙江村保单 fixture 受保护，跳过生成: {out}")
            return
        raise SystemExit("龙江村保单 fixture 不存在，现役数据缺失；请先恢复后再操作")

    name = village_name(code)
    parcel = parcel_path(code)
    if not parcel.exists():
        raise SystemExit(f"missing local parcel source: {parcel}")
    source = json.loads(parcel.read_text(encoding="utf-8"))
    features = sorted(source["features"], key=lambda f: int(f["properties"]["id"]))
    areas = {str(f["properties"]["id"]): Decimal(str(f["properties"]["area_mu"])).quantize(Decimal("0.0001")) for f in features}
    ids = list(areas)
    conf = confirmation_path(code)
    if not conf.exists():
        raise SystemExit(f"missing immutable parcel confirmation: {conf}; run prepare-policy-confirmation.py --village {code} first")
    confirmation = json.loads(conf.read_text(encoding="utf-8"))
    if confirmation.get("schemaVersion") != "parcel-confirmation-v1" or len(confirmation.get("records", [])) != len(ids):
        raise SystemExit(f"invalid parcel confirmation schema or coverage for {code}")
    confirmed = {record["parcelId"]: record for record in confirmation["records"]}
    if set(confirmed) != set(ids) or any(record.get("insured") and not record.get("insuredPartyId") for record in confirmed.values()):
        raise SystemExit("confirmation must uniquely cover all parcels and assign every insured parcel")
    uninsured = {parcel_id for parcel_id, record in confirmed.items() if not record["insured"]}
    insured_ids = [i for i in ids if i not in uninsured]
    parties = [{"id": "party-roster", "name": f"{name}股份经济合作社", "partyType": "村集体"}]
    policies: list[dict] = []
    items: list[dict] = []
    coverages: list[dict] = []
    claims: list[dict] = []
    item_no = 1
    party_no = 1

    def add_party(party_type: str) -> str:
        nonlocal party_no
        pid = f"party-{party_no:04d}"
        pname = party_name(party_no, code)
        parties.append({"id": pid, "name": pname, "partyType": party_type, **party_profile(party_no, pname, code)})
        party_no += 1
        return pid

    def add_policy(pid: str, mode: str, insured_party: str | None, item_ids: list[str], coverage_ids: list[str], year: int, status: str = "保障中") -> None:
        policy_id = f"policy-{year}-{pid}"
        # 22 位：{村代码12位}{年4位}{序号6位}，跨村唯一
        policy_no = f"{code}{year}{len(policies) + 1:06d}"
        total_area = sum((Decimal(c["insuredAreaMu"]) for c in coverages if c["id"] in coverage_ids), Decimal("0"))
        sums = {k: sum((money(Decimal(c["insuredAreaMu"]))[k] for c in coverages if c["id"] in coverage_ids), 0) for k in ("sum_insured_cents", "premium_cents", "subsidy_cents", "self_paid_cents")}
        policies.append({"id": policy_id, "policyNo": policy_no, "insuredMode": mode, "insuredPartyId": insured_party, "enrollmentListId": f"list-{policy_id}" if mode == "insured_roster" else None, "villageCode": code, "product": PRODUCT, "insuredObject": "水稻", "unitSumInsuredCentsPerMu": PER_MU_CENTS, "premiumRate": "0.032", "subsidyRate": "0.80", "signDate": f"{year}-04-15", "periodStart": f"{year}-05-01", "periodEnd": f"{year}-11-30", "status": status, "summary": {"insuredPartyCount": len(item_ids) if mode == "insured_roster" else 1, "parcelCount": len(coverage_ids), "insuredAreaMu": str(total_area.quantize(Decimal("0.0001"))), **sums}})

    confirmed_groups: dict[str, list[str]] = {}
    for parcel_id in insured_ids:
        confirmed_groups.setdefault(confirmed[parcel_id]["insuredPartyId"], []).append(parcel_id)
    multi_parcel_groups = [group for group in confirmed_groups.values() if len(group) > 1]
    if len(multi_parcel_groups) > 4:
        raise SystemExit(f"confirmation must contain at most four multi-parcel operating regions for {code}")
    for confirmed_party_id, group in sorted(confirmed_groups.items(), key=lambda item: item[0]):
        party_number = int(confirmed_party_id.rsplit("-", 1)[-1])
        party_type = "家庭农场" if party_number <= 4 else "自然人"
        # 直接使用确认文件的 party id，避免 add_party 递增序列与确认编号错位
        # （小村回收区会在确认编号中留空洞）
        party = confirmed_party_id
        parties.append({"id": party, "name": party_name(party_number, code), "partyType": party_type, **party_profile(party_number, party_name(party_number, code), code)})
        area = sum((areas[i] for i in group), Decimal("0"))
        classified = area.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        # 50 亩分类规则按被保险人汇总面积（非地块数）：>50.00 亩单独出单一型保单，
        # <=50.00 亩进入分户清单。单块大田（如 63 亩）也必须单独出单。
        mode = "single_insured" if classified > Decimal("50.00") else "insured_roster"
        if mode == "single_insured" and area.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) <= Decimal("50.00"):
            raise SystemExit(f"four-region single policy must exceed 50 mu: {party} = {area}")
        if mode == "single_insured":
            cov_ids = []
            for parcel_id in group:
                cid = f"coverage-2025-{parcel_id}"
                cov_ids.append(cid)
                coverages.append({"id": cid, "policyId": f"policy-2025-{party}", "parcelId": parcel_id, "insuredPartyId": party, "insuredAreaMu": str(areas[parcel_id]), "enrollmentItemId": None})
            add_policy(party, mode, party, [], cov_ids, 2025)
        else:
            # 分类面积 <=50 亩：进入分户清单。确认脚本已保证 roster 严格一块一户
            # （每块一个独立 party；小村 <50 亩的区也逐块回收），此处直接用确认 party。
            if len(group) != 1:
                raise SystemExit(f"roster party 必须一块一户: {party} 有 {len(group)} 块")
            parcel_id = group[0]
            item_id = f"item-2025-{item_no:04d}"
            cid = f"coverage-2025-{parcel_id}"
            coverages.append({"id": cid, "policyId": "policy-2025-roster", "parcelId": parcel_id, "insuredPartyId": party, "insuredAreaMu": str(areas[parcel_id]), "enrollmentItemId": item_id})
            block_area = areas[parcel_id]
            items.append({"id": item_id, "enrollmentListId": "list-policy-2025-roster", "itemNo": f"{code[-4:]}-{item_no:04d}", "insuredPartyId": party, "parcelCoverageIds": [cid], "insuredAreaMu": str(block_area), **money(block_area)})
            item_no += 1

    # Patch the policy IDs on single coverages now that the policy IDs are known; roster policy is fixed.
    for c in coverages:
        if c["policyId"] != "policy-2025-roster":
            c["policyId"] = f"policy-2025-{c['insuredPartyId']}"
    roster_cov = [c["id"] for c in coverages if c["policyId"] == "policy-2025-roster"]
    add_policy("roster", "insured_roster", None, [i["id"] for i in items], roster_cov, 2025)
    for p in policies:
        if p["id"] == "policy-2025-roster":
            p["enrollmentListId"] = "list-policy-2025-roster"
    # Historical snapshot intentionally overlaps current parcels and is never re-derived by the UI.
    history_party = add_party("合作社")
    hist_cov = []
    for parcel_id in insured_ids[:40]:
        cid = f"coverage-2024-{parcel_id}"
        hist_cov.append(cid)
        coverages.append({"id": cid, "policyId": "policy-2024-history", "parcelId": parcel_id, "insuredPartyId": history_party, "insuredAreaMu": str(areas[parcel_id]), "enrollmentItemId": None})
    add_policy("history", "single_insured", history_party, [], hist_cov, 2024, "已到期")
    claims.extend([
        {"id": "claim-2025-001", "policyId": "policy-2025-roster", "insuredPartyId": items[0]["insuredPartyId"], "enrollmentItemId": items[0]["id"], "reportCount": 2, "estimatedLossCents": 180000, "paidCents": 0, "latestReportDate": "2025-06-18", "latestStatus": "核赔中"},
        {"id": "claim-2025-002", "policyId": "policy-2025-roster", "insuredPartyId": items[1]["insuredPartyId"], "enrollmentItemId": items[1]["id"], "reportCount": 1, "estimatedLossCents": 92000, "paidCents": 92000, "latestReportDate": "2025-05-28", "latestStatus": "已结案"},
        {"id": "claim-2024-001", "policyId": "policy-2024-history", "insuredPartyId": history_party, "reportCount": 1, "estimatedLossCents": 60000, "paidCents": 60000, "latestReportDate": "2024-08-01", "latestStatus": "已结案"},
    ])
    current_policies = [policy for policy in policies if policy["status"] != "已到期"]
    report = {"fixtureVersion": "policy-v1.1.0", "businessDate": BUSINESS_DATE, "villageCode": code, "baseParcelCount": len(ids), "insuredParcelCount": len(insured_ids), "uninsuredParcelCount": len(uninsured), "uninsuredAreaMu": str(sum((areas[i] for i in uninsured), Decimal("0"))), "partyCount": len(parties), "policyCount": len(policies), "currentPolicyCount": len(current_policies), "currentSinglePolicyCount": sum(p["insuredMode"] == "single_insured" for p in current_policies), "currentRosterPolicyCount": sum(p["insuredMode"] == "insured_roster" for p in current_policies), "rosterItemCount": len(items), "spatialReview": {"confirmationVersion": "parcel-confirmation-v1", "confirmedAt": confirmation["confirmedAt"], "confirmedBy": confirmation["confirmedBy"], "grouping": confirmation.get("assignmentModel", "fixed confirmation"), "insuredPartyMetrics": confirmation.get("spatialReview", [])}}
    fixture = {"schemaVersion": "policy-v1", "businessDate": BUSINESS_DATE, "villageCode": code, "parties": parties, "policies": policies, "enrollmentLists": [{"id": "list-policy-2025-roster", "policyId": "policy-2025-roster", "applicantPartyId": "party-roster", "itemIds": [i["id"] for i in items]}], "enrollmentItems": items, "parcelCoverages": coverages, "claims": claims, "report": report}

    records = []
    uninsured_sorted = sorted(uninsured, key=int)
    for parcel_id in ids:
        if parcel_id in uninsured:
            # 未参保地块按未参保集合内序号每 5 块保留 1 块初始档案，且序号 1 必保留
            # （避免依赖 parcel ID 取模分布；白沙等小村未参保块数少时也保证至少 1 块有档案）
            if (uninsured_sorted.index(parcel_id) + 1) % 5 != 0 and uninsured_sorted.index(parcel_id) != 0:
                continue
        records.append({"villageCode": code, "parcelId": parcel_id, "year": 2025, "season": "单季稻" if int(parcel_id) % 3 == 0 else ("早稻" if int(parcel_id) % 3 == 1 else "连作晚稻"), "crop": "水稻", "variety": "甬优1540" if int(parcel_id) % 2 else "嘉优中科1号", "startDate": "2025-05-01", "endDate": "2025-11-30", "status": "已核查" if int(parcel_id) % 11 else "需复核", "checkedAt": "2025-06-20" if int(parcel_id) % 11 else "2025-06-22", "note": ""})
    cultivation_output = json.dumps({"schemaVersion": "cultivation-v1", "businessDate": BUSINESS_DATE, "records": records}, ensure_ascii=False, indent=2)

    src_out = ROOT / "web/src/data"
    src_out.mkdir(parents=True, exist_ok=True)
    public_business = ROOT / "web/public/business"
    public_business.mkdir(parents=True, exist_ok=True)
    (src_out / f"policy-{code}.json").write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8")
    (src_out / f"cultivation-{code}.json").write_text(cultivation_output, encoding="utf-8")
    (public_business / f"policy-{code}.json").write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8")
    (public_business / f"cultivation-{code}.json").write_text(cultivation_output, encoding="utf-8")
    (src_out / f"policy-{code}.report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 4+1 保单与种植档案 fixture")
    parser.add_argument("--village", default=DEFAULT_VILLAGE, help=f"村代码（默认 {DEFAULT_VILLAGE}）")
    args = parser.parse_args()
    generate(args.village)


if __name__ == "__main__":
    main()

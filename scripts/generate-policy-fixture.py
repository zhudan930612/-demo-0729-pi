"""Generate the versioned, non-identifying V1 business fixtures from the local parcel pilot."""
from __future__ import annotations
import hashlib
import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARCEL = ROOT / "web/public/data/parcels/330604102014.geojson"
OUT = ROOT / "web/src/data"
BUSINESS_DATE = "2025-07-15"
PRODUCT = "政策性水稻完全成本保险"
PER_MU_CENTS = 125000
RATE = Decimal("0.032")
SUBSIDY = Decimal("0.80")
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


def party_name(number: int) -> str:
    if number in PARTY_NAMES:
        return PARTY_NAMES[number]
    index = number - 5
    return f"{SURNAMES[index % len(SURNAMES)]}{GIVEN_NAMES[index % len(GIVEN_NAMES)]}"


def identity_number(number: int) -> str:
    age = 35 + number % 26
    year = 2025 - age
    month = number * 5 % 6 + 1
    day = number * 7 % 27 + 1
    sequence = number * 37 % 999 + 1
    body = f"330604{year:04d}{month:02d}{day:02d}{sequence:03d}"
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


def bank_account(number: int) -> str:
    digest = hashlib.sha256(f"longjiang-psbc-{number}".encode()).hexdigest()
    suffix = f"{int(digest[:16], 16) % 10**12:012d}"
    body = f"621799{suffix}"
    return f"{body}{luhn_check_digit(body)}"


def party_profile(number: int, name: str) -> dict[str, str]:
    phone = f"{('13', '15', '18')[number % 3]}{570000000 + number * 7919:08d}"
    return {
        "identityOrOrgCode": identity_number(number),
        "contactPhone": phone,
        "bankAccount": bank_account(number),
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


def main() -> None:
    if not PARCEL.exists():
        raise SystemExit(f"missing local parcel source: {PARCEL}")
    source = json.loads(PARCEL.read_text(encoding="utf-8"))
    features = sorted(source["features"], key=lambda f: int(f["properties"]["id"]))
    areas = {str(f["properties"]["id"]): Decimal(str(f["properties"]["area_mu"])).quantize(Decimal("0.0001")) for f in features}
    ids = list(areas)
    confirmation_path = ROOT / "web/src/data/parcel-confirmation-v1.json"
    if not confirmation_path.exists():
        raise SystemExit("missing immutable parcel confirmation; run prepare-policy-confirmation.py and complete review first")
    confirmation = json.loads(confirmation_path.read_text(encoding="utf-8"))
    if confirmation.get("schemaVersion") != "parcel-confirmation-v1" or len(confirmation.get("records", [])) != len(ids):
        raise SystemExit("invalid parcel confirmation schema or coverage")
    confirmed = {record["parcelId"]: record for record in confirmation["records"]}
    if set(confirmed) != set(ids) or any(record.get("insured") and not record.get("insuredPartyId") for record in confirmed.values()):
        raise SystemExit("confirmation must uniquely cover all parcels and assign every insured parcel")
    uninsured = {parcel_id for parcel_id, record in confirmed.items() if not record["insured"]}
    insured_ids = [i for i in ids if i not in uninsured]
    parties = [{"id": "party-roster", "name": "龙江村股份经济合作社", "partyType": "村集体"}]
    policies: list[dict] = []
    items: list[dict] = []
    coverages: list[dict] = []
    claims: list[dict] = []
    current_policy_ids: list[str] = []
    item_no = 1
    party_no = 1

    def add_party(party_type: str) -> str:
        nonlocal party_no
        pid = f"party-{party_no:04d}"
        name = party_name(party_no)
        parties.append({"id": pid, "name": name, "partyType": party_type, **party_profile(party_no, name)})
        party_no += 1
        return pid

    def add_policy(pid: str, mode: str, insured_party: str | None, item_ids: list[str], coverage_ids: list[str], year: int, status: str = "保障中") -> None:
        policy_id = f"policy-{year}-{pid}"
        policy_no = f"2025{year}{len(policies)+1:014d}"[-22:]
        total_area = sum((Decimal(c["insuredAreaMu"]) for c in coverages if c["id"] in coverage_ids), Decimal("0"))
        sums = {k: sum((money(Decimal(c["insuredAreaMu"]))[k] for c in coverages if c["id"] in coverage_ids), 0) for k in ("sum_insured_cents", "premium_cents", "subsidy_cents", "self_paid_cents")}
        policies.append({"id": policy_id, "policyNo": policy_no, "insuredMode": mode, "insuredPartyId": insured_party, "enrollmentListId": f"list-{policy_id}" if mode == "insured_roster" else None, "villageCode": "330604102014", "product": PRODUCT, "insuredObject": "水稻", "unitSumInsuredCentsPerMu": PER_MU_CENTS, "premiumRate": "0.032", "subsidyRate": "0.80", "signDate": f"{year}-04-15", "periodStart": f"{year}-05-01", "periodEnd": f"{year}-11-30", "status": status, "summary": {"insuredPartyCount": len(item_ids) if mode == "insured_roster" else 1, "parcelCount": len(coverage_ids), "insuredAreaMu": str(total_area.quantize(Decimal("0.0001"))), **sums}})
        current_policy_ids.append(policy_id) if year == 2025 else None

    confirmed_groups: dict[str, list[str]] = {}
    for parcel_id in insured_ids:
        confirmed_groups.setdefault(confirmed[parcel_id]["insuredPartyId"], []).append(parcel_id)
    if len([group for group in confirmed_groups.values() if len(group) > 1]) != 4:
        raise SystemExit("confirmation must contain exactly four multi-parcel operating regions")
    for confirmed_party_id, group in sorted(confirmed_groups.items()):
        party_number = int(confirmed_party_id.rsplit("-", 1)[-1])
        party_type = "家庭农场" if party_number <= 4 else "自然人"
        party = add_party(party_type)
        if party != confirmed_party_id:
            raise SystemExit(f"confirmation party sequence mismatch: {confirmed_party_id} != {party}")
        area = sum((areas[i] for i in group), Decimal("0"))
        mode = "single_insured" if len(group) > 1 else "insured_roster"
        if mode == "single_insured" and area.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) <= Decimal("50.00"):
            raise SystemExit(f"four-region single policy must exceed 50 mu: {party} = {area}")
        item_id = f"item-2025-{item_no:04d}" if mode == "insured_roster" else None
        cov_ids = []
        for parcel_id in group:
            cid = f"coverage-2025-{parcel_id}"
            cov_ids.append(cid)
            coverages.append({"id": cid, "policyId": f"policy-2025-{party}" if mode == "single_insured" else "policy-2025-roster", "parcelId": parcel_id, "insuredPartyId": party, "insuredAreaMu": str(areas[parcel_id]), "enrollmentItemId": item_id})
        if mode == "single_insured":
            add_policy(party, mode, party, [], cov_ids, 2025)
        else:
            items.append({"id": item_id, "enrollmentListId": "list-policy-2025-roster", "itemNo": f"LJ-{item_no:04d}", "insuredPartyId": party, "parcelCoverageIds": cov_ids, "insuredAreaMu": str(area), **money(area)})
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
    report = {"fixtureVersion": "policy-v1.1.0", "businessDate": BUSINESS_DATE, "villageCode": "330604102014", "baseParcelCount": len(ids), "insuredParcelCount": len(insured_ids), "uninsuredParcelCount": len(uninsured), "uninsuredAreaMu": str(sum((areas[i] for i in uninsured), Decimal("0"))), "partyCount": len(parties), "policyCount": len(policies), "currentPolicyCount": len(current_policies), "currentSinglePolicyCount": sum(p["insuredMode"] == "single_insured" for p in current_policies), "currentRosterPolicyCount": sum(p["insuredMode"] == "insured_roster" for p in current_policies), "rosterItemCount": len(items), "spatialReview": {"confirmationVersion": "parcel-confirmation-v1", "confirmedAt": confirmation["confirmedAt"], "confirmedBy": confirmation["confirmedBy"], "grouping": confirmation.get("assignmentModel", "fixed confirmation"), "insuredPartyMetrics": confirmation.get("spatialReview", [])}}
    fixture = {"schemaVersion": "policy-v1", "businessDate": BUSINESS_DATE, "villageCode": "330604102014", "parties": parties, "policies": policies, "enrollmentLists": [{"id": "list-policy-2025-roster", "policyId": "policy-2025-roster", "applicantPartyId": "party-roster", "itemIds": [i["id"] for i in items]}], "enrollmentItems": items, "parcelCoverages": coverages, "claims": claims, "report": report}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "policy-v1.json").write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8")
    records = []
    for parcel_id in ids:
        if parcel_id in uninsured and int(parcel_id) % 5 != 0: continue
        records.append({"villageCode": "330604102014", "parcelId": parcel_id, "year": 2025, "season": "单季稻" if int(parcel_id) % 3 == 0 else ("早稻" if int(parcel_id) % 3 == 1 else "连作晚稻"), "crop": "水稻", "variety": "甬优1540" if int(parcel_id) % 2 else "嘉优中科1号", "startDate": "2025-05-01", "endDate": "2025-11-30", "status": "已核查" if int(parcel_id) % 11 else "需复核", "checkedAt": "2025-06-20" if int(parcel_id) % 11 else "2025-06-22", "note": ""})
    cultivation_output = json.dumps({"schemaVersion": "cultivation-v1", "businessDate": BUSINESS_DATE, "records": records}, ensure_ascii=False, indent=2)
    (OUT / "cultivation-v1.json").write_text(cultivation_output, encoding="utf-8")
    public_business = ROOT / "web/public/business"
    public_business.mkdir(parents=True, exist_ok=True)
    (public_business / "policy-v1.json").write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8")
    (public_business / "cultivation-v1.json").write_text(cultivation_output, encoding="utf-8")
    (OUT / "policy-v1.report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))

if __name__ == "__main__": main()

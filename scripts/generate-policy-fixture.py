"""Generate the versioned, non-identifying V1 business fixtures from the local parcel pilot.

地块成片划分 V1（替换 4+1 模型）：
- 龙江村与全部参保村同一套规则，全部授权重新生成（龙江村产物保持 legacy v1 文件名）。
- 大户数量自适应：按确认文件 insuredPartyId 分组，分类面积 >50.00 亩单独出单一型保单，
  ≤50.00 亩逐块一块一户进团单（团单严格一块一户，回收地块也一块一户）；
  同村同年度同产品恰好 1 张分户清单型保单。
- 姓名/证件/银行卡：确定性生成器（村代码参与 salt 与地区码），不取自真实资料；
  地区码取村代码前 6 位（县区码，章镇 330604、三界 330683）。
- 保单号：22 位数字，`{村代码}{年}{序号}`，保证跨村项目内唯一。
- 清单项编号：`{村代码后4位}-{序号}`；龙江村保持历史 `LJ-` 前缀规则一致。
- 报告记录大户覆盖占比与每户指标（地块数/面积/最大跨度/孤岛列表）。
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
# 龙江村历史固定大户名单（party 1~4 沿用，其余走生成器；均为演示合成姓名）
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


def output_names(code: str) -> tuple[str, str, str]:
    """返回 (policy, cultivation, report) 文件名；龙江村保持历史 v1 文件名。"""
    if code == DEFAULT_VILLAGE:
        return "policy-v1.json", "cultivation-v1.json", "policy-v1.report.json"
    return f"policy-{code}.json", f"cultivation-{code}.json", f"policy-{code}.report.json"


def party_name(number: int, code: str) -> str:
    """2~3 汉字姓名生成器；每村以村代码偏移避免跨村重名，村内 lcm(姓氏,名) 周期内唯一。"""
    if code == DEFAULT_VILLAGE and number in PARTY_NAMES:
        return PARTY_NAMES[number]
    offset = int(code[-6:]) % len(SURNAMES)  # 姓氏表长度 94（与既有生成器口径一致，确定性偏移）
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
    # 区域模式（user-annotated-regions-v1）：以确认文件 spatialReview 的大户身份为准——区域 party 单独出单一型保单，
    # 其余团单池全部一块一户进团单（忽略 50 亩单独出单规则，仅区域划分；团单池块 ≤50 亩由数据保证）
    region_mode = confirmation.get("assignmentModel") == "user-annotated-regions-v1"
    single_parties = {m["insuredPartyId"] for m in confirmation.get("spatialReview", [])
                      if m.get("insuredModePreview") == "single_insured"} if region_mode else set()
    big_farm_policy_ids: list[str] = []
    for confirmed_party_id, group in sorted(confirmed_groups.items(), key=lambda item: item[0]):
        group = sorted(group, key=int)
        party_number = int(confirmed_party_id.rsplit("-", 1)[-1])
        area = sum((areas[i] for i in group), Decimal("0"))
        classified = area.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if region_mode:
            # 区域模式：区域 party 单独出单一型保单；其余单块 party 一块一户进团单
            mode = "single_insured" if confirmed_party_id in single_parties else "insured_roster"
        else:
            # 聚类模式：50 亩分类规则按被保险人汇总面积（非地块数）：分类面积（内部 4 位小数求和、四舍五入 2 位）
            # >50.00 亩 → 单一型保单单独出单（单块大田也立大户）；≤50.00 亩 → 团单一块一户。
            mode = "single_insured" if classified > Decimal("50.00") else "insured_roster"
        if mode == "single_insured":
            party_type = "家庭农场"  # 大户（单一型）
        else:
            party_type = "自然人"
            # 团单严格一块一户（确认脚本已保证；此处防御性校验）
            if len(group) != 1:
                raise SystemExit(f"roster party 必须一块一户: {confirmed_party_id} 有 {len(group)} 块")
        party = confirmed_party_id
        parties.append({"id": party, "name": party_name(party_number, code), "partyType": party_type, **party_profile(party_number, party_name(party_number, code), code)})
        if mode == "single_insured":
            cov_ids = []
            for parcel_id in group:
                cid = f"coverage-2025-{parcel_id}"
                cov_ids.append(cid)
                coverages.append({"id": cid, "policyId": f"policy-2025-{party}", "parcelId": parcel_id, "insuredPartyId": party, "insuredAreaMu": str(areas[parcel_id]), "enrollmentItemId": None})
            add_policy(party, mode, party, [], cov_ids, 2025)
            big_farm_policy_ids.append(f"policy-2025-{party}")
        else:
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
    # 历史 party 编号推进到确认 party 最大编号之后，保证 parties 内 id 全局唯一（审查 B1）
    if confirmed_groups:
        party_no = max(int(pid.rsplit("-", 1)[-1]) for pid in confirmed_groups) + 1
    history_party = add_party("合作社")
    hist_cov = []
    for parcel_id in insured_ids[:40]:
        cid = f"coverage-2024-{parcel_id}"
        hist_cov.append(cid)
        coverages.append({"id": cid, "policyId": "policy-2024-history", "parcelId": parcel_id, "insuredPartyId": history_party, "insuredAreaMu": str(areas[parcel_id]), "enrollmentItemId": None})
    add_policy("history", "single_insured", history_party, [], hist_cov, 2024, "已到期")
    # 理赔摘要引用团单清单项；团单为空（全大户村）时只保留历史理赔，不报错
    if items:
        claims.append({"id": "claim-2025-001", "policyId": "policy-2025-roster", "insuredPartyId": items[0]["insuredPartyId"], "enrollmentItemId": items[0]["id"], "reportCount": 2, "estimatedLossCents": 180000, "paidCents": 0, "latestReportDate": "2025-06-18", "latestStatus": "核赔中"})
        if len(items) >= 2:
            claims.append({"id": "claim-2025-002", "policyId": "policy-2025-roster", "insuredPartyId": items[1]["insuredPartyId"], "enrollmentItemId": items[1]["id"], "reportCount": 1, "estimatedLossCents": 92000, "paidCents": 92000, "latestReportDate": "2025-05-28", "latestStatus": "已结案"})
    claims.append({"id": "claim-2024-001", "policyId": "policy-2024-history", "insuredPartyId": history_party, "reportCount": 1, "estimatedLossCents": 60000, "paidCents": 60000, "latestReportDate": "2024-08-01", "latestStatus": "已结案"})
    current_policies = [policy for policy in policies if policy["status"] != "已到期"]
    big_farm_coverages = [c for c in coverages if c["policyId"] in big_farm_policy_ids]
    big_farm_area = sum((Decimal(c["insuredAreaMu"]) for c in big_farm_coverages), Decimal("0"))
    insured_area_total = sum((areas[i] for i in insured_ids), Decimal("0"))
    big_farm_share = round(float(big_farm_area / insured_area_total), 4) if insured_area_total else 0
    report = {"fixtureVersion": "policy-v1.2.0", "businessDate": BUSINESS_DATE, "villageCode": code, "baseParcelCount": len(ids), "insuredParcelCount": len(insured_ids), "uninsuredParcelCount": len(uninsured), "uninsuredAreaMu": str(sum((areas[i] for i in uninsured), Decimal("0"))), "partyCount": len(parties), "policyCount": len(policies), "currentPolicyCount": len(current_policies), "currentSinglePolicyCount": sum(p["insuredMode"] == "single_insured" for p in current_policies), "currentRosterPolicyCount": sum(p["insuredMode"] == "insured_roster" for p in current_policies), "rosterItemCount": len(items), "bigFarmCount": len(big_farm_policy_ids), "bigFarmParcelCount": len(big_farm_coverages), "bigFarmInsuredAreaMu": str(big_farm_area.quantize(Decimal("0.0001"))), "insuredAreaMu": str(insured_area_total.quantize(Decimal("0.0001"))), "bigFarmCoverageShareOfInsuredArea": big_farm_share, "spatialReview": {"confirmationVersion": "parcel-confirmation-v1", "confirmedAt": confirmation["confirmedAt"], "confirmedBy": confirmation["confirmedBy"], "grouping": confirmation.get("assignmentModel", "fixed confirmation"), "insuredPartyMetrics": confirmation.get("spatialReview", [])}}
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

    policy_name, cultivation_name, report_name = output_names(code)
    src_out = ROOT / "web/src/data"
    src_out.mkdir(parents=True, exist_ok=True)
    public_business = ROOT / "web/public/business"
    public_business.mkdir(parents=True, exist_ok=True)
    (src_out / policy_name).write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8")
    (src_out / cultivation_name).write_text(cultivation_output, encoding="utf-8")
    (public_business / policy_name).write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8")
    (public_business / cultivation_name).write_text(cultivation_output, encoding="utf-8")
    (src_out / report_name).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="生成成片聚类保单与种植档案 fixture（地块成片划分 V1）")
    parser.add_argument("--village", default=DEFAULT_VILLAGE, help=f"村代码（默认 {DEFAULT_VILLAGE}）")
    args = parser.parse_args()
    generate(args.village)


if __name__ == "__main__":
    main()

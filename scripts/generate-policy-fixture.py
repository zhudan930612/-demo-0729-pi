"""Generate the versioned, non-identifying V1 business fixtures from the local parcel pilot."""
from __future__ import annotations
import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARCEL = ROOT / "web/public/data/parcels/330604102014.geojson"
OUT = ROOT / "web/src/data"
BUSINESS_DATE = "2025-07-15"
PRODUCT = "水稻完全成本保险"
PER_MU_CENTS = 125000
RATE = Decimal("0.032")
SUBSIDY = Decimal("0.80")


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
    # Fixed confirmation: 94.8% insured, with a contiguous spatially local uninsure sample.
    uninsured = {str(i) for i in range(1451, 1534)}
    # Versioned confirmation is an immutable input to generation, not an auto-selected result.
    confirmation_path = ROOT / "web/src/data/parcel-confirmation-v1.json"
    confirmation = {
        "schemaVersion": "parcel-confirmation-v1",
        "villageCode": "330604102014",
        "confirmedAt": "2025-04-01",
        "confirmedBy": "operator-01",
        "records": [{"parcelId": parcel_id, "insured": parcel_id not in uninsured, "insuredPartyId": None if parcel_id in uninsured else "pending", "confirmedAt": "2025-04-01", "confirmedBy": "operator-01"} for parcel_id in ids],
    }
    # The generator creates the immutable review artifact; production generation must consume this file.
    confirmation_path.write_text(json.dumps(confirmation, ensure_ascii=False, indent=2), encoding="utf-8")
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
        parties.append({"id": pid, "name": f"龙江村{party_type}{party_no:03d}", "partyType": party_type})
        party_no += 1
        return pid

    def add_policy(pid: str, mode: str, insured_party: str | None, item_ids: list[str], coverage_ids: list[str], year: int, status: str = "保障中") -> None:
        policy_id = f"policy-{year}-{pid}"
        policy_no = f"2025{year}{len(policies)+1:014d}"[-22:]
        total_area = sum((Decimal(c["insuredAreaMu"]) for c in coverages if c["id"] in coverage_ids), Decimal("0"))
        sums = {k: sum((money(Decimal(c["insuredAreaMu"]))[k] for c in coverages if c["id"] in coverage_ids), 0) for k in ("sum_insured_cents", "premium_cents", "subsidy_cents", "self_paid_cents")}
        policies.append({"id": policy_id, "policyNo": policy_no, "insuredMode": mode, "insuredPartyId": insured_party, "enrollmentListId": f"list-{policy_id}" if mode == "insured_roster" else None, "villageCode": "330604102014", "product": PRODUCT, "insuredObject": "水稻", "unitSumInsuredCentsPerMu": PER_MU_CENTS, "premiumRate": "0.032", "subsidyRate": "0.80", "signDate": f"{year}-04-15", "periodStart": f"{year}-05-01", "periodEnd": f"{year}-11-30", "status": status, "summary": {"insuredPartyCount": len(item_ids) if mode == "insured_roster" else 1, "parcelCount": len(coverage_ids), "insuredAreaMu": str(total_area.quantize(Decimal("0.0001"))), **sums}})
        current_policy_ids.append(policy_id) if year == 2025 else None

    # Six compact contiguous groups demonstrate single-insured policies. The remaining
    # contiguous groups are accumulated up to 50 mu, so classification is produced by
    # the confirmed spatial assignment rather than by splitting a person's coverage.
    pos = 0
    single_count = 0
    while pos < len(insured_ids):
        if single_count < 6:
            group = insured_ids[pos:pos + 60]
            single_count += 1
            mode = "single_insured"
        else:
            group = []
            area = Decimal("0")
            while pos + len(group) < len(insured_ids):
                candidate = areas[insured_ids[pos + len(group)]]
                if group and area + candidate > Decimal("50"):
                    break
                group.append(insured_ids[pos + len(group)])
                area += candidate
                if area >= Decimal("49"):
                    break
            mode = "insured_roster"
        party = add_party("家庭农场" if mode == "single_insured" or item_no % 3 == 0 else "自然人")
        cov_ids = []
        item_id = None
        if mode == "insured_roster": item_id = f"item-2025-{item_no:04d}"
        for parcel_id in group:
            cid = f"coverage-2025-{parcel_id}"
            cov_ids.append(cid)
            coverages.append({"id": cid, "policyId": f"policy-2025-{party}" if mode == "single_insured" else "policy-2025-roster", "parcelId": parcel_id, "insuredPartyId": party, "insuredAreaMu": str(areas[parcel_id]), "enrollmentItemId": item_id})
        area = sum((areas[i] for i in group), Decimal("0"))
        if mode == "single_insured":
            add_policy(party, mode, party, [], cov_ids, 2025)
        else:
            items.append({"id": item_id, "enrollmentListId": "list-policy-2025-roster", "itemNo": f"LJ-{item_no:04d}", "insuredPartyId": party, "parcelCoverageIds": cov_ids, "insuredAreaMu": str(area), **money(area)})
            item_no += 1
        pos += len(group)

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
    report = {"fixtureVersion": "policy-v1.0.0", "businessDate": BUSINESS_DATE, "villageCode": "330604102014", "baseParcelCount": len(ids), "insuredParcelCount": len(insured_ids), "uninsuredParcelCount": len(uninsured), "uninsuredAreaMu": str(sum((areas[i] for i in uninsured), Decimal("0"))), "partyCount": len(parties), "policyCount": len(policies), "singlePolicyCount": sum(p["insuredMode"] == "single_insured" for p in policies), "rosterItemCount": len(items), "spatialReview": {"confirmationVersion": "parcel-confirmation-v1", "confirmedAt": "2025-04-01", "confirmedBy": "operator-01", "grouping": "local contiguous fixed confirmation"}}
    fixture = {"schemaVersion": "policy-v1", "businessDate": BUSINESS_DATE, "villageCode": "330604102014", "parties": parties, "policies": policies, "enrollmentLists": [{"id": "list-policy-2025-roster", "policyId": "policy-2025-roster", "applicantPartyId": "party-roster", "itemIds": [i["id"] for i in items]}], "enrollmentItems": items, "parcelCoverages": coverages, "claims": claims, "report": report}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "policy-v1.json").write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8")
    records = []
    for parcel_id in ids:
        if parcel_id in uninsured and int(parcel_id) % 5 != 0: continue
        records.append({"villageCode": "330604102014", "parcelId": parcel_id, "year": 2025, "season": "单季稻" if int(parcel_id) % 3 == 0 else ("早稻" if int(parcel_id) % 3 == 1 else "连作晚稻"), "crop": "水稻", "variety": "甬优1540" if int(parcel_id) % 2 else "嘉优中科1号", "startDate": "2025-05-01", "endDate": "2025-11-30", "status": "已核查" if int(parcel_id) % 11 else "需复核", "checkedAt": "2025-06-20" if int(parcel_id) % 11 else "2025-06-22", "note": ""})
    (OUT / "cultivation-v1.json").write_text(json.dumps({"schemaVersion": "cultivation-v1", "businessDate": BUSINESS_DATE, "records": records}, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "policy-v1.report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))

if __name__ == "__main__": main()

#!/usr/bin/env python3
"""用真实 NDVI 栅格按【每期】重算农情业务聚合（农情概况/异常top/保单长势/任务）。

- 输入：web/public/data/agri/ndvi.json（真实 224m，4 期）+ 13 参保村村界/地块/保单 fixture
- 输出：web/public/data/agri/agri-business.json
        { dates,[ villages:[ [date0 13村], ... ], levels:[各期 byCode], policyGrowth:[各期{村码:[保单]}],
          tasks:[各期[任务]] }  —— 前端按选中日期取用（聚合跟随热力图日期）
"""
from __future__ import annotations
import importlib.util, json
from pathlib import Path
import numpy as np

REPO = Path(__file__).resolve().parent.parent
AGRI = REPO / "web/public/data/agri"
spec = importlib.util.spec_from_file_location("G", REPO / "scripts/generate-agri-monitoring.py")
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)

ndvi = json.load(open(AGRI / "ndvi.json", encoding="utf-8"))
origin_lon, origin_lat = ndvi["originLon"], ndvi["originLat"]
step_lon, step_lat = ndvi["stepLon"], ndvi["stepLat"]
cols, rows = ndvi["cols"], ndvi["rows"]
DATES = ndvi["dates"]
layers = [np.array(ndvi["layers"][d], dtype="float32").reshape(rows, cols) for d in range(len(DATES))]


def level_for_parcel(parcel, di):
    lng, lat = parcel.get("lng"), parcel.get("lat")
    if lng is None or lat is None:
        return None
    ci = int(round((lng - origin_lon) / step_lon - 0.5))
    ri = int(round((lat - origin_lat) / step_lat - 0.5))
    if ri < 0 or ri >= rows or ci < 0 or ci >= cols:
        return None
    v = layers[di][ri, ci]
    if np.isnan(v) or v <= 0:
        return None
    return float(v) / 100.0  # ndvi.json 存 NDVI×100 整数，转回 [0,1]


def parcel_level_area(pol, parcels, di):
    la = {lv: 0.0 for lv in G.LEVELS}
    tot = 0.0
    for cov in pol["coverage_list"]:
        p = parcels.get(cov["parcelId"])
        if not p:
            continue
        v = level_for_parcel(p, di)
        if v is None:
            continue
        la[G.ndvi_level(v)] += cov["insuredAreaMu"]
        tot += cov["insuredAreaMu"]
    return la, tot


def village_growth_for_date(di):
    result = {}
    for code, name in G.INSURED_VILLAGES:
        fixture = G.load_policy_fixture(code)
        key = {"name": name, "insuredAreaMu": 0, "householdCount": 0, "policyCount": 0,
               "levels": {lv: 0 for lv in G.LEVELS}, "anomalyRatio": 0, "isAnomaly": False,
               "countyCode": code[:6], "cityCode": code[:4] + "00",
               "townshipCode": G.VILLAGE_PREFIX_TOWNSHIP.get(code[:9], ""), "data": False}
        if not fixture:
            result[code] = key
            continue
        pol = G.summarize_policy(fixture)
        la, tot = parcel_level_area(pol, G.load_parcels(code), di)
        if tot <= 0:
            result[code] = {**key, "insuredAreaMu": pol["insured_area"], "householdCount": pol["household_count"],
                            "policyCount": pol["policy_count"]}
            continue
        ratios = {lv: round(la[lv] / tot, 4) for lv in G.LEVELS}
        anomaly = round(ratios["veryPoor"] + ratios["poor"], 4)
        result[code] = {
            "name": name, "insuredAreaMu": pol["insured_area"], "householdCount": pol["household_count"],
            "policyCount": pol["policy_count"], "levels": ratios, "anomalyRatio": anomaly,
            "isAnomaly": anomaly > G.ANOMALY_THRESHOLD,
            "countyCode": code[:6], "cityCode": code[:4] + "00",
            "townshipCode": G.VILLAGE_PREFIX_TOWNSHIP.get(code[:9], ""), "data": True,
        }
    return result


def policy_growth_for_date(village_code, di):
    fixture = G.load_policy_fixture(village_code)
    if not fixture:
        return []
    pol = G.summarize_policy(fixture)
    parcels = G.load_parcels(village_code)
    party_names = {str(p.get("id", "")): str(p.get("name", "")) for p in fixture.get("parties", [])}
    rows = []
    for policy in fixture.get("policies", []):
        pid = str(policy.get("id", ""))
        if policy.get("status") != "保障中":
            continue
        sub = {"coverage_list": [c for c in pol["coverage_list"] if c["policyId"] == pid]}
        la, tot = parcel_level_area(sub, parcels, di)
        ratios = {lv: round(la[lv] / tot, 4) for lv in G.LEVELS} if tot > 0 else {lv: 0 for lv in G.LEVELS}
        insured_mode = str(policy.get("insuredMode", ""))
        insured_pid = str(policy.get("insuredPartyId", ""))
        insured = party_names.get(insured_pid, "")
        # 有地块 → 真实投保人名；无地块 → 团单用村集体/合作社名，大户用占位农户名
        if not insured:
            insured = G.insurer_name_for(insured_mode, village_code, pid, party_names)
        rows.append({"policyId": pid, "policyNo": str(policy.get("policyNo", pid)), "insuredMode": insured_mode,
                     "insuredName": insured, "insuredPartyId": insured_pid, "insuredAreaMu": round(tot, 2),
                     "levels": ratios, "premiumRate": str(policy.get("premiumRate", ""))})
    return rows


def main():
    villages = G.load_village_boundaries()
    manifest = G.load_manifest()
    all_villages = []
    all_levels = []
    all_policy = []
    all_tasks = []
    for di in range(len(DATES)):
        vg = village_growth_for_date(di)
        all_villages.append([
            {"code": code, "name": villages[code]["name"], "centroid": villages[code]["centroid"],
             **{k: vg[code][k] for k in ["insuredAreaMu", "householdCount", "policyCount", "levels", "anomalyRatio", "isAnomaly", "countyCode", "cityCode", "townshipCode", "data"]}}
            for code, name in G.INSURED_VILLAGES
        ])
        all_levels.append(G.build_level_aggregation(vg, manifest))
        all_policy.append({code: policy_growth_for_date(code, di) for code, _ in G.INSURED_VILLAGES})
        all_tasks.append(G.generate_tasks(villages, vg))
    payload = {"dates": DATES, "villages": all_villages, "levels": all_levels,
               "policyGrowth": all_policy, "tasks": all_tasks}
    with open(AGRI / "agri-business.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print("✓ agri-business.json")
    for di, date in enumerate(DATES):
        anomaly = [v["name"] for v in all_villages[di] if v["isAnomaly"]]
        print(f"  {date}: 异常村 {len(anomaly)} 个 -> {', '.join(anomaly) if anomaly else '无'} | 任务 {len(all_tasks[di])}")


if __name__ == "__main__":
    main()

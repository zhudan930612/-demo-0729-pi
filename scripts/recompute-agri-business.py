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
        if not insured:
            if insured_mode == "insured_roster":
                # 有地块团单：{首位户名}等{N}户种植户（与实际地块/投保农户一致）
                lid = str(policy.get("enrollmentListId", ""))
                ids = []
                for e in fixture.get("enrollmentItems", []):
                    iid = str(e.get("insuredPartyId", ""))
                    if iid and iid not in ids:
                        ids.append(iid)
                if ids:
                    first = party_names.get(ids[0], "") or "农户"
                    insured = f"{first}等{len(ids)}户种植户"
                else:
                    insured = G.insurer_name_for(insured_mode, village_code, pid, party_names)
            else:
                insured = G.insurer_name_for(insured_mode, village_code, pid, party_names)
        rows.append({"policyId": pid, "policyNo": str(policy.get("policyNo", pid)), "insuredMode": insured_mode,
                     "insuredName": insured, "insuredPartyId": insured_pid, "insuredAreaMu": round(tot, 2),
                     "levels": ratios, "premiumRate": str(policy.get("premiumRate", ""))})
    return rows


# 各类任务的执行要求（按类型）；同一任务类型一致
REQUIREMENT_BY_TYPE = {
    "poor_growth": "48 小时内到场核查并提交结论；异常地块拍照留痕，备注减产程度与承保面积。",
    "training": "按计划完成培训并留存签到与影像；参训农户覆盖率 ≥ 90%。",
    "fertilization": "如实记录施肥作业（时间/面积/投入品）；异常情况及时上报。",
    "policy_advocacy": "完成宣导并留存影像；确保农户知晓保障/补贴政策，收集意见反馈。",
    "site_survey": "查勘后 48 小时内提交查勘记录与影像材料，明确损失程度。",
    "key_followup": "更新重点对象台账，反馈承保/续保意向；异常诉求及时上报。",
}

# 各类任务的 SOP（分点、具体）；同一任务类型 SOP 一致
SOP_BY_TYPE = {
    "poor_growth": "1. 携带遥感图斑定位异常地块；\n2. 现场核对作物长势、受害程度与承保面积；\n3. 拍照留痕（田块全景+近景）并记录坐标；\n4. 询问农户减产情况，核实是否与承保一致；\n5. 48 小时内反馈核查结论。",
    "training": "1. 确认培训对象并核对签到名单；\n2. 讲解水稻绿色防控/栽培技术要点；\n3. 现场实操示范并答疑；\n4. 发放培训资料并留存影像记录。",
    "fertilization": "1. 核对追肥地块与施肥方案；\n2. 现场督导施肥作业（用量/方式）；\n3. 记录施肥时间、面积与投入品；\n4. 拍照留痕并反馈。",
    "policy_advocacy": "1. 确认宣导对象（农户/村级）；\n2. 讲解政策性农险保障与补贴政策；\n3. 解答农户疑问并收集意见；\n4. 发放宣导资料并留影。",
    "site_survey": "1. 携带查勘工具与现场底图；\n2. 查明受灾地块范围与程度；\n3. 拍照/测产/记录损失；\n4. 出具查勘记录并反馈。",
    "key_followup": "1. 确认重点对象（大户/回访名单）；\n2. 了解承保/续保意向与诉求；\n3. 记录跟进情况并更新台账；\n4. 反馈后续承保建议。",
}


def linked_policy(village_code):
    """取村内一条保单（编号 + 投保人）作为任务关联保单（理赔可查证据）。"""
    fx = G.load_policy_fixture(village_code)
    if not fx:
        return {"policyNo": "", "insuredName": ""}
    policies = [p for p in fx.get("policies", []) if p.get("status") == "保障中"]
    parties = {str(p.get("id", "")): str(p.get("name", "")) for p in fx.get("parties", [])}
    if not policies:
        return {"policyNo": "", "insuredName": ""}
    p = policies[0]
    pid = str(p.get("insuredPartyId", ""))
    insured = parties.get(pid, "")
    if not insured and str(p.get("insuredMode", "")) == "insured_roster":
        insured = parties.get("party-roster", "集体投保")
    return {"policyNo": str(p.get("policyNo", "")), "insuredName": insured or "集体投保"}


def demo_tasks(villages):
    """额外演示任务：不同状态/类型，用于任务列表展示（异常监测派发之外）。"""
    items = list(villages.items())
    spec = [
        # (id, 具体标题name, 类别typeName, type, status, 村索引, 日期, 备注)
        ("task-demo-1", "三分场水稻长势异常核查", "核查异常长势", "poor_growth", "待下发", 0, "2026-08-03", "三分场水稻长势异常，需到场核实"),
        ("task-demo-2", "水稻绿色防控技术培训", "农作培训", "training", "已完成", 1, "2026-07-30", "水稻绿色防控技术培训"),
        ("task-demo-3", "早稻追肥作业督导", "督导施肥", "fertilization", "进行中", 2, "2026-07-28", "追肥作业督导与记录"),
        ("task-demo-4", "政策性农险政策宣导", "政策宣导", "policy_advocacy", "待下发", 3, "2026-07-26", "政策性农业保险政策宣导"),
        ("task-demo-5", "受灾地块现场查勘定损", "现场查勘", "site_survey", "进行中", 4, "2026-07-24", "受灾地块现场查勘定损"),
        ("task-demo-6", "种植大户承保跟进", "重点对象跟进", "key_followup", "待领取", 5, "2026-07-22", "种植大户承保跟进"),
        ("task-demo-7", "旱情地块长势复核", "核查异常长势", "poor_growth", "待领取", 6, "2026-07-20", "旱情地块长势复核"),
        ("task-demo-8", "村级协保员业务培训", "农作培训", "training", "已完成", 7, "2026-07-18", "村级协保员业务培训"),
        ("task-demo-9", "新增承保地块查勘", "现场查勘", "site_survey", "已完成", 0, "2026-07-16", "新增承保地块现场查勘"),
        ("task-demo-10", "育秧补贴政策宣导", "政策宣导", "policy_advocacy", "已完成", 1, "2026-07-14", "育秧补贴政策宣导"),
    ]
    rows = []
    for tid, name, type_name, typ, status, vidx, date, remark in spec:
        code, vmeta = items[vidx % len(items)]
        vname = vmeta["name"]; centroid = vmeta.get("centroid") or {}
        # 仅 异常核查/督导施肥/现场查勘(定损)/重点对象跟进 类任务需关联保单，其余不关联
        NEED_POLICY = {"poor_growth", "fertilization", "site_survey", "key_followup"}
        pol = linked_policy(code) if typ in NEED_POLICY else {"policyNo": "", "insuredName": ""}
        executors = [
            {"name": "胡强", "role": "村级协保员"}, {"name": "陈志远", "role": "乡级协保员"}, {"name": "王芳", "role": "村级协保员"},
            {"name": "刘建华", "role": "乡级协保员"}, {"name": "张国强", "role": "村级协保员"}, {"name": "赵丽华", "role": "乡级协保员"},
            {"name": "李建国", "role": "村级协保员"}, {"name": "周晓梅", "role": "乡级协保员"},
        ]
        ex = executors[abs(int(tid.rsplit('-', 1)[-1])) % len(executors)] if status in ("进行中", "已完成") else None
        rows.append({
            "id": tid, "name": name, "type": typ, "typeName": type_name, "status": status,
            "villageCode": code, "villageName": vname, "createdAt": date,
            "executor": ex,
            "remark": remark, "sopAction": SOP_BY_TYPE.get(typ, "到场核实并拍照留痕。"),
            "requirement": REQUIREMENT_BY_TYPE.get(typ, "48 小时内反馈。"),
            "policyNo": pol["policyNo"], "policyInsuredName": pol["insuredName"],
            "location": {"name": vname, "lon": centroid.get("lon", 0), "lat": centroid.get("lat", 0)},
            "evidence": [],
        })
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
        tasks_of_date = G.generate_tasks(villages, vg) + demo_tasks(villages)
        for idx, t in enumerate(tasks_of_date):
            t["taskNo"] = f"RW-2026-{idx + 1:04d}"  # 任务编号
        all_tasks.append(tasks_of_date)
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

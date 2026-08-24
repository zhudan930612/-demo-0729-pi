#!/usr/bin/env python3
"""农情监测 V1 —— 数据校验脚本（对应 R2-8 数据脚本校验 + 5 级分布 + 异常口径 + 任务状态）。

依据: docs/requirements/农情监测-V1需求.md (v1.15)
校验点:
  R2-8  相邻日期（每 7 天）同一区域长势自然过渡，无反复横跳（阈值：均值绝对差 < 0.03，单格 max < 0.10）
  5级   全省栅格五档均有真实数据支撑（R2-5 五级配色可验收）
  异常  异常top 只列 极差+较差承保面积占比 > 30% 的村
  村    村 5 级占比归一（≈1）、承保面积非负
  任务  四态（待下发/待领取/进行中/已完成）、字段齐全、证据图片存在
"""
from __future__ import annotations
import json
import math
import sys
from pathlib import Path
import numpy as np

REPO = Path(__file__).resolve().parent.parent
AGRI = REPO / "web" / "public" / "data" / "agri"
LEVELS = ["veryPoor", "poor", "normal", "good", "excellent"]
LEVEL_THRESHOLDS = [0.4, 0.55, 0.7, 0.8]
ANOMALY_THRESHOLD = 0.30
STATES = ["待下发", "待领取", "进行中", "已完成"]

fail = 0

def check(name, cond, detail=""):
    global fail
    status = "✅" if cond else "❌"
    if not cond:
        fail += 1
    print(f"  {status} {name}" + (f"  ({detail})" if detail else ""))

print("== 农情监测数据校验 ==")

# --- NDVI 栅格 ---
ndvi = json.load(open(AGRI / "ndvi.json", encoding="utf-8"))
dates = ndvi["dates"]
grid = ndvi["grid"]
print(f"\n[栅格] {len(dates)} 日期, {len(grid)} 个省内点")

# 重建每日期值场
def value_at_di(point, di):
    return point["values"][di] / 100.0

# R2-8 时序连续性：同一格相邻日期差值
print("\n[R2-8] 相邻日期时序连续性 (禁止反复横跳):")
max_adj = 0.0
mean_adj = 0.0
cnt = 0
for p in grid:
    vals = [value_at_di(p, di) for di in range(len(dates))]
    for di in range(len(dates) - 1):
        d = abs(vals[di + 1] - vals[di])
        max_adj = max(max_adj, d)
        mean_adj += d
        cnt += 1
mean_adj /= max(1, cnt)
check("相邻日期均值绝对差 < 0.03", mean_adj < 0.03, f"mean={mean_adj:.4f}")
check("相邻日期单格 max 差 < 0.10", max_adj < 0.10, f"max={max_adj:.4f}")

# 每期全省 5 级分布（最近一期为例）
last_di = len(dates) - 1
level_counter = {lv: 0 for lv in LEVELS}
for p in grid:
    v = value_at_di(p, last_di)
    lv = "veryPoor" if v < LEVEL_THRESHOLDS[0] else "poor" if v < LEVEL_THRESHOLDS[1] else "normal" if v < LEVEL_THRESHOLDS[2] else "good" if v < LEVEL_THRESHOLDS[3] else "excellent"
    level_counter[lv] += 1
total = len(grid)
print(f"\n[5级分布·最近一期] " + " ".join(f"{lv}={level_counter[lv]} ({level_counter[lv]/total:.1%})" for lv in LEVELS))
check("五档均有真实数据", all(level_counter[lv] > 0 for lv in LEVELS),
      " | ".join(f"{lv}={level_counter[lv]}" for lv in LEVELS))

# --- 村级 ---
villages = json.load(open(AGRI / "villages.json", encoding="utf-8"))
print(f"\n[村] {len(villages)} 个参保村")
anomaly_ok = True
ratio_ok = True
area_ok = True
for v in villages:
    s = sum(v["levels"].values())
    if abs(s - 1.0) > 0.02:
        ratio_ok = False
        print(f"     占比不归一: {v['name']} sum={s:.3f}")
    if v["insuredAreaMu"] < 0:
        area_ok = False
    if v["isAnomaly"] != (v["anomalyRatio"] > ANOMALY_THRESHOLD):
        anomaly_ok = False
check("村级 5 级占比归一 (≈1)", ratio_ok)
check("村级承保面积非负", area_ok)
check("异常判定 = 极差+较差占比 > 30%", anomaly_ok)
anomaly_villages = [v for v in villages if v["isAnomaly"]]
print(f"   异常村: {len(anomaly_villages)} 个 → " + ", ".join(v["name"] for v in anomaly_villages))
check("异常村占比>30% 且只列超标村", all(v["anomalyRatio"] > ANOMALY_THRESHOLD for v in anomaly_villages))

# --- 层级聚合 ---
levels = json.load(open(AGRI / "levels.json", encoding="utf-8"))
by_code = levels["byCode"]
print(f"\n[层级] byCode 共 {len(by_code)} 个区域: " + ", ".join(f"{k}={v['name']}" for k, v in by_code.items()))
# 全省承保面积 = Σ村
prov_area = by_code["330000"]["insuredAreaMu"]
sum_village = sum(v["insuredAreaMu"] for v in villages)
check("省承保面积 = Σ村承保面积", abs(prov_area - sum_village) < 1.0, f"prov={prov_area} sum={sum_village}")
# 村级/市级/县级/镇级 承保面积层级一致（章镇镇→上虞区→绍兴市→省）
tz = by_code.get("330604104000", {}).get("insuredAreaMu", 0)
county = by_code.get("330604", {}).get("insuredAreaMu", 0)
city = by_code.get("330600", {}).get("insuredAreaMu", 0)
check("章镇镇承保面积 ≤ 上虞区 ≤ 绍兴市", tz <= county <= city, f"{tz} <= {county} <= {city}")

# --- 任务 ---
tasks = json.load(open(AGRI / "tasks.json", encoding="utf-8"))
print(f"\n[任务] {len(tasks)} 条")
state_ok = all(t["status"] in STATES for t in tasks)
check("任务状态为四态之一", state_ok)
fields_ok = all(all(k in t for k in ["id", "name", "type", "villageCode", "villageName", "status", "createdAt", "remark", "sopAction", "requirement", "location", "evidence"]) for t in tasks)
check("任务字段齐全", fields_ok)
# 待下发/待领取 执行人为空；已完成/进行中 绑执行人
exec_ok = True
for t in tasks:
    if t["status"] in ("待下发", "待领取") and t["executor"] is not None:
        exec_ok = False
    if t["status"] in ("已完成", "进行中") and t["executor"] is None:
        exec_ok = False
check("待下发/待领取 无执行人，已完成/进行中 有执行人", exec_ok)
# 证据图片存在
ev_missing = []
for t in tasks:
    for e in t["evidence"]:
        fname = (REPO / "web" / "public" / e["url"].lstrip("/"))
        if not fname.exists():
            ev_missing.append(e["url"])
check("证据图片存在", not ev_missing, f"missing={len(ev_missing)}")

# --- 保单维度 ---
print(f"\n[保单维度] 检查 13 村 policy-growth 文件:")
pg_ok = True
for v in villages:
    f = AGRI / f"policy-growth-{v['code']}.json"
    if not f.exists():
        pg_ok = False
        continue
    rows = json.load(open(f, encoding="utf-8"))
    for r in rows:
        s = sum(r["levels"].values())
        # 允许无数据保单（sum≈0），其余应归一
        if abs(s - 1.0) > 0.02 and s > 0.001:
            pg_ok = False
            print(f"    {v['name']} {r['policyNo']} sum={s:.3f} area={r['insuredAreaMu']}")
check("保单维度 5 级占比归一", pg_ok)

print("\n" + ("✅ 全部通过" if fail == 0 else f"❌ {fail} 项失败"))
sys.exit(0 if fail == 0 else 1)

#!/usr/bin/env python3
"""
农情监测 V1 —— 演示数据生成脚本（NDVI 长势百米级连续栅格场 + 村/级聚合 + 保单长势 + 任务/证据）

依据: docs/requirements/农情监测-V1需求.md (v1.15 定稿)

产物目录: web/public/data/agri/
  - ndvi.json                     多日期 NDVI 连续栅格场（热力图渲染用）
  - villages.json                 13 参保村聚合（5 级占比 / 承保面积 / 异常）
  - levels.json                   省/市/县/镇 各级聚合（农情概况用）
  - policy-growth-{村码}.json     村级保单维度长势（5 级占比）
  - tasks.json                    预生成任务（四态 / SOP / 证据 / 备注 / 定位）
  - evidence/*.png                证据占位图

口径:
  - 承保面积按保单 fixture 汇总（与 web/src/features/village-risk/villagePolicySummary.ts 同源）
  - 5 级分档阈值: 极差<0.4 / 较差0.4~<0.55 / 正常0.55~<0.7 / 较好0.7~<0.8 / 极好>=0.8
  - 异常 = (极差+较差) 承保面积占比 > 30%
  - 农情概况 / 异常top / 任务列表 取最近一期（最后日期）

造数方案（三层叠加）:
  ① 村基准: 各参保村从正态分布抽样（均值落"正常"档，少数村落到较差/极差）
  ② 村内空间平滑噪声: Perlin 噪声（种子锚定村码+栅格坐标），村内连续分布、不碎斑
  ③ 时序趋势: 沿生长季缓慢上升→峰值→平稳，加小幅扰动，各期不独立采样
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_PUBLIC = REPO_ROOT / "web" / "public"
DATA_DIR = WEB_PUBLIC / "data"
AGRI_DIR = DATA_DIR / "agri"
BUSINESS_DIR = WEB_PUBLIC / "business"
EVIDENCE_DIR = AGRI_DIR / "evidence"

# 栅格参数（全省 bbox；step ≈ 0.004° ≈ 440m）
LON_MIN, LON_MAX = 118.0, 123.0
LAT_MIN, LAT_MAX = 27.0, 31.5
LON_STEP = 0.006
LAT_STEP = 0.006
COLS = int(round((LON_MAX - LON_MIN) / LON_STEP))
ROWS = int(round((LAT_MAX - LAT_MIN) / LAT_STEP))

# 多日期（2026-06 至 2026-07，每 7 天一期；最近一期=最后日期）
DATES = [
    "2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29",
    "2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27",
]
LAST_DATE_INDEX = len(DATES) - 1

# 5 级分档阈值（NDVI 校准；极好>=0.8 而非 0.9——NDVI 峰值一般 <=0.85）
LEVELS = ["veryPoor", "poor", "normal", "good", "excellent"]
LEVEL_THRESHOLDS = [0.4, 0.55, 0.7, 0.8]

ANOMALY_THRESHOLD = 0.30
ANOMALY_TYPES = {
    "poor_growth": {"name": "核查异常长势", "sop": "携带遥感图斑定位异常地块，核实作物长势与承保面积是否一致、是否存在明显减产。", "requirement": "到场核实并拍照留痕，48 小时内反馈核查结论。"},
    "pesticide": {"name": "核查农药使用", "sop": "入户核实是否按规定用足农药，对农药瓶、购药凭证拍照留痕。", "requirement": "核查用药记录并拍照上传，24 小时内反馈。"},
    "key_object": {"name": "核查重点对象", "sop": "对重点对象（历史理赔异常、面积与地块不符、多保重保）逐户核对承保信息。", "requirement": "重点对象逐户核对，2 个工作日内反馈。"},
}

INSURED_VILLAGES = [
    ("330604102014", "龙江村"), ("330604102011", "新南村"), ("330604102015", "大钱村"),
    ("330604102016", "清潭村"), ("330604102017", "新魏家庄村"), ("330604102018", "新三联村"),
    ("330604102020", "新魏村"), ("330604102033", "湾头村"),
    ("330683104307", "临虞村"), ("330683104306", "北街村"), ("330683104224", "白沙村"),
    ("330683104308", "车骑山村"), ("330683104309", "盛岙村"),
]
INSURED_CODES = [code for code, _ in INSURED_VILLAGES]
TOWNSHIP_FILES = {
    "330604102": "/data/villages/330604104000.geojson",
    "330683104": "/data/villages/330683104000.geojson",
}
VILLAGE_PREFIX_TOWNSHIP = {
    "330604102": "330604104000",
    "330683104": "330683104000",
}

INSURANCE_STAFF = [
    {"name": "王协保", "role": "协保员"}, {"name": "李协保", "role": "协保员"},
    {"name": "张协保", "role": "协保员"}, {"name": "陈协保", "role": "协保员"},
    {"name": "赵协保", "role": "协保员"},
]
STAFF_ASSIGN_IDS = ["330604102014", "330604102015", "330683104307", "330604102016"]


# ---------------------------------------------------------------------------
# 通用工具
# ---------------------------------------------------------------------------
def stable_seed(*parts: str) -> int:
    h = hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return int(h[:16], 16)


def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  ✓ {path.relative_to(REPO_ROOT)} ({os.path.getsize(path)/1024:.0f} KB)")


def collect_rings(geometry) -> list:
    rings = []
    if geometry["type"] == "Polygon":
        rings.append(geometry["coordinates"])
    elif geometry["type"] == "MultiPolygon":
        for poly in geometry["coordinates"]:
            rings.append(poly)
    return rings


def load_province_geom():
    gj = load_json(WEB_PUBLIC / "data" / "boundary" / "province.geojson")
    return gj["features"][0]["geometry"]


def load_village_boundaries():
    """加载 13 参保村村界（shapely Polygon 列表）与乡镇归属、质心。"""
    from shapely.geometry import Polygon, MultiPolygon
    result = {}
    for file in set(TOWNSHIP_FILES.values()):
        path = (WEB_PUBLIC / file.lstrip("/")).resolve()
        if not path.exists():
            continue
        gj = load_json(path)
        for ft in gj["features"]:
            code = str(ft["properties"].get("code", ""))
            if code not in INSURED_CODES:
                continue
            polys = []
            for rings in collect_rings(ft["geometry"]):
                if len(rings[0]) >= 3:
                    polys.append(Polygon(rings[0], rings[1:]))
            if polys:
                mp = MultiPolygon(polys)
                c = mp.centroid
                result[code] = {
                    "name": str(ft["properties"].get("name", code)),
                    "polygons": polys,
                    "county_code": code[:6],
                    "centroid": {"lon": c.x, "lat": c.y, "name": str(ft["properties"].get("name", code))},
                }
    return result


def load_parcels(village_code: str) -> dict:
    path = DATA_DIR / "parcels" / f"{village_code}.geojson"
    if not path.exists():
        return {}
    gj = load_json(path)
    parcels = {}
    for ft in gj["features"]:
        pid = ft["properties"].get("id")
        if pid is None:
            continue
        parcels[int(pid)] = {
            "lng": ft["properties"].get("label_lng"),
            "lat": ft["properties"].get("label_lat"),
            "area_mu": ft["properties"].get("area_mu"),
        }
    return parcels


def load_policy_fixture(village_code: str) -> dict | None:
    name = "policy-v1.json" if village_code == "330604102014" else f"policy-{village_code}.json"
    path = BUSINESS_DIR / name
    return load_json(path) if path.exists() else None


def load_manifest() -> dict:
    return load_json(DATA_DIR / "manifest.json")


# ---------------------------------------------------------------------------
# Perlin / value noise（向量化 numpy；村+栅格坐标锚定，多期空间结构一致）
# ---------------------------------------------------------------------------
def _hash_noise(ix, iy, seed, octaves=1):
    """基于栅格整数坐标的确定性 value-noise（多倍频平滑插值），返回 [-1, 1]。"""
    seed = int(seed) & 0x7FFFFFFF
    ix = np.asarray(ix, dtype=np.float64)
    iy = np.asarray(iy, dtype=np.float64)
    total = np.zeros(np.broadcast(ix, iy).shape, dtype=np.float64)
    amplitude = 1.0
    freq = 1.0
    amp_sum = 0.0
    for _ in range(octaves):
        xi = np.floor(ix * freq).astype(np.int64)
        yi = np.floor(iy * freq).astype(np.int64)

        def corner(ox, oy):
            xv = (xi + ox).astype(np.int64)
            yv = (yi + oy).astype(np.int64)
            h = (xv * 73856093 + yv * 19349663 + seed) & 0x7FFFFFFF
            v = (h.astype(np.uint64) * 2654435761) & 0xFFFFFFFF
            return (v / 4294967295.0).astype(np.float64)

        a, b = corner(0, 0), corner(1, 0)
        c, d = corner(0, 1), corner(1, 1)
        fx = np.asarray(ix, dtype=np.float64) * freq - np.floor(np.asarray(ix, dtype=np.float64) * freq)
        fy = np.asarray(iy, dtype=np.float64) * freq - np.floor(np.asarray(iy, dtype=np.float64) * freq)
        fx = fx * fx * (3 - 2 * fx)
        fy = fy * fy * (3 - 2 * fy)
        top = a + (b - a) * fx
        bot = c + (d - c) * fx
        total += amplitude * (top + (bot - top) * fy)
        amp_sum += amplitude
        amplitude *= 0.5
        freq *= 2.0
    return (total / amp_sum) * 2.0 - 1.0


def point_in_polygons_mask(polys, lons, lats):
    """点在任意多边形内（外环含且不被洞含），向量化。polys: shapely Polygon 列表。"""
    mask = np.zeros(lons.shape, dtype=bool)
    for poly in polys:
        outer = np.asarray(poly.exterior.coords, dtype=np.float64)
        inside = np_point_in_ring(outer[:, 0], outer[:, 1], lons, lats)
        for hole in poly.interiors:
            h = np.asarray(hole.coords, dtype=np.float64)
            inside &= ~np_point_in_ring(h[:, 0], h[:, 1], lons, lats)
        mask |= inside
    return mask


def _smooth_noise(shape, seed, sigma):
    """高斯平滑随机场（种子确定、标准化 NaN 除外）：无偏、有机，用于村级尺度长势马赛克。"""
    from scipy.ndimage import gaussian_filter
    rng = np.random.default_rng(seed)
    field = rng.normal(size=shape)
    field = gaussian_filter(field, sigma=sigma, mode="reflect")
    # 归一化（均 0 方 1），避免幅度随分辨率漂移
    field = (field - field.mean()) / (field.std() + 1e-9)
    return field


def np_point_in_ring(rlons, rlats, lons, lats):
    inside = np.zeros(lons.shape, dtype=bool)
    j = len(rlons) - 1
    for i in range(len(rlons)):
        xi, yi = rlons[i], rlats[i]
        xj, yj = rlons[j], rlats[j]
        cond = ((yi > lats) != (yj > lats)) & (lons < (xj - xi) * (lats - yi) / (yj - yi) + xi)
        inside ^= cond
        j = i
    return inside


def rasterize_province_mask(province_geom):
    """把省界（MultiPolygon rings）栅格化为布尔掩膜，PIL 快速填充。"""
    img = Image.new("1", (COLS, ROWS), 0)
    d = ImageDraw.Draw(img)
    polygons = collect_rings(province_geom)

    def xy(lon, lat):
        return ((lon - LON_MIN) / LON_STEP, (lat - LAT_MIN) / LAT_STEP)

    # 外环先填充白，后洞擦黑（避免跨 poly 洞遮挡）
    for rings in polygons:
        pts = [xy(lon, lat) for lon, lat in rings[0]]
        if len(pts) >= 3:
            d.polygon(pts, fill=1)
    for rings in polygons:
        for hole in rings[1:]:
            pts = [xy(lon, lat) for lon, lat in hole]
            if len(pts) >= 3:
                d.polygon(pts, fill=0)
    return np.array(img, dtype=bool)


# ---------------------------------------------------------------------------
# NDVI 场生成
# ---------------------------------------------------------------------------
def build_ndvi_field(villages: dict, province_geom):
    lon_centers = LON_MIN + (np.arange(COLS) + 0.5) * LON_STEP
    lat_centers = LAT_MIN + (np.arange(ROWS) + 0.5) * LAT_STEP
    LON_GRID, LAT_GRID = np.meshgrid(lon_centers, lat_centers)  # [rows, cols]

    in_province = rasterize_province_mask(province_geom)

    # ---------- ① 村基准 ----------
    village_baseline = {}
    anomaly_target = set(["330604102014", "330604102011", "330604102015", "330683104307"])
    for code, name in INSURED_VILLAGES:
        rng = random.Random(stable_seed("baseline", code))
        if code in anomaly_target:
            # 异常村：基准落较差/较差-正常边界（异常top 有充分数据 + 极差档有值 + 非全村皆差）
            village_baseline[code] = rng.uniform(0.44, 0.52)
        else:
            # 非异常村：正态抽样式基准，均值落正常档（0.63），少数落到较好
            base = rng.gauss(0.63, 0.055)
            village_baseline[code] = min(0.74, max(0.52, base))

    # ---------- 全省背景场：村级尺度多色块马赛克（非参保区模拟村级长势） ----------
    # 监测最小单位=村级；每个村级区域有独立长势基准（跨多个档位），村内百米级栅格仍有 5 级变化。
    # 村级尺度基准（σ≈4 格 ≈2.6km）：不同村级区域落入不同档位 → 多色块交错（无偏，避免大片同色）
    village_base_noise = _smooth_noise((ROWS, COLS), stable_seed("village-base"), 4)
    # 村内变化（σ≈1.5 格 ≈1km）：每个村级斑块内部仍有 5 级色块变化（非均匀）
    intra_noise = _smooth_noise((ROWS, COLS), stable_seed("village-intra"), 1.5)
    # 基准：以正常/较好为主（自然），较差/极差与极好为少量区域
    bg_base = 0.62 + village_base_noise * 0.11 + intra_noise * 0.045

    n_dates = len(DATES)

    def season_curve(t):
        x = t / (n_dates - 1)
        if x <= 0.75:
            return 0.5 * (1 - math.cos(math.pi * x / 0.75))
        return 1.0 - 0.08 * (x - 0.75) / 0.25

    season_vals = np.array([season_curve(t) for t in range(n_dates)])

    # ---------- 各村空间场（子网格构建，避免全图逐点） ----------
    village_cells = {}  # code -> (ri0, ri1, ci0, ci1, LON_SUB, LAT_SUB, mask, baseline, noise, fine, amp)
    for code, info in villages.items():
        polys = info["polygons"]
        alllon = [c[0] for poly in polys for ring in [poly.exterior] for c in ring.coords]
        alllat = [c[1] for poly in polys for ring in [poly.exterior] for c in ring.coords]
        lon_min, lon_max = min(alllon), max(alllon)
        lat_min, lat_max = min(alllat), max(alllat)
        ci0 = max(0, int(math.floor((lon_min - LON_MIN) / LON_STEP)))
        ci1 = min(COLS - 1, int(math.ceil((lon_max - LON_MIN) / LON_STEP)))
        ri0 = max(0, int(math.floor((lat_min - LAT_MIN) / LAT_STEP)))
        ri1 = min(ROWS - 1, int(math.ceil((lat_max - LAT_MIN) / LAT_STEP)))
        lon_sub = lon_centers[ci0:ci1 + 1]
        lat_sub = lat_centers[ri0:ri1 + 1]
        ls, lt = np.meshgrid(lon_sub, lat_sub)
        mask = point_in_polygons_mask(polys, ls, lt)
        if not mask.any():
            continue
        # 网格整数坐标（栅格 cell 索引），用于噪声锚定
        ix = (ls - LON_MIN) / LON_STEP
        iy = (lt - LAT_MIN) / LAT_STEP
        noise = _hash_noise(ix / 2.0, iy / 2.0, stable_seed("noise", code), octaves=2)
        fine = _hash_noise(ix, iy, stable_seed("fine", code), octaves=1) * 0.04
        amp = _hash_noise(ix / 3.0, iy / 3.0, stable_seed("season-amp", code), octaves=1) * 0.02
        # 异常村空间异质性强（退化田块），噪声幅大；正常村相对均匀，幅小
        noise_amp = 0.35 if code in anomaly_target else 0.16
        season_amp = 0.07 if code in anomaly_target else 0.12
        village_cells[code] = {
            "ri0": ri0, "ri1": ri1, "ci0": ci0, "ci1": ci1,
            "mask": mask, "baseline": village_baseline[code],
            "noise": noise, "fine": fine, "noise_amp": noise_amp, "amp": season_amp + amp,
        }

    # ---------- 组装多日期层 ----------
    layers = []
    for d in range(n_dates):
        layer = bg_base + season_vals[d] * 0.055
        layer = layer.copy()
        for code, fc in village_cells.items():
            sub = layer[fc["ri0"]:fc["ri1"] + 1, fc["ci0"]:fc["ci1"] + 1]
            base = np.clip(fc["baseline"], 0.30, 0.86)
            val = base + fc["noise"] * fc["noise_amp"] + season_vals[d] * fc["amp"] + fc["fine"]
            layer[fc["ri0"]:fc["ri1"] + 1, fc["ci0"]:fc["ci1"] + 1] = np.where(fc["mask"], val, sub)
        layer = np.clip(layer, 0.25, 0.9)
        layer[~in_province] = np.nan
        layers.append(layer)
    return layers, lon_centers, lat_centers


def ndvi_level(value: float) -> str:
    if value < LEVEL_THRESHOLDS[0]:
        return "veryPoor"
    if value < LEVEL_THRESHOLDS[1]:
        return "poor"
    if value < LEVEL_THRESHOLDS[2]:
        return "normal"
    if value < LEVEL_THRESHOLDS[3]:
        return "good"
    return "excellent"


# ---------------------------------------------------------------------------
# 保单/承保面积聚合（承保面积口径 = 保单 fixture 汇总）
# ---------------------------------------------------------------------------
def summarize_policy(fixture: dict) -> dict:
    active = [p for p in fixture.get("policies", []) if str(p.get("status", "")) == "保障中"]
    unit_by_policy = {}
    mode_by_policy = {}
    for p in active:
        pid = str(p.get("id", ""))
        if pid:
            unit_by_policy[pid] = float(p.get("unitSumInsuredCentsPerMu") or 0)
            mode_by_policy[pid] = str(p.get("insuredMode", ""))
    active_ids = set(unit_by_policy)
    insured_area = 0.0
    coverage_list = []
    household_ids = set()
    for c in fixture.get("parcelCoverages", []):
        pid = str(c.get("policyId", ""))
        if pid not in active_ids:
            continue
        mu = float(c.get("insuredAreaMu") or 0)
        insured_area += mu
        party = str(c.get("insuredPartyId", ""))
        if party:
            household_ids.add(party)
        coverage_list.append({
            "parcelId": int(c["parcelId"]), "policyId": pid, "partyId": party,
            "insuredAreaMu": mu, "mode": mode_by_policy.get(pid, ""),
        })
    for item in fixture.get("enrollmentItems", []):
        party = str(item.get("insuredPartyId", ""))
        if party:
            household_ids.add(party)
    for party in fixture.get("parties", []):
        if str(party.get("partyType", "")) == "村集体":
            household_ids.discard(str(party.get("id", "")))
    return {
        "insured_area": round(insured_area, 2),
        "household_count": len(household_ids),
        "policy_count": len(active),
        "coverage_list": coverage_list,
    }


def level_for_parcel(parcel, layers, lon_centers, lat_centers):
    lng, lat = parcel.get("lng"), parcel.get("lat")
    if lng is None or lat is None:
        return None
    ci = int(round((lng - LON_MIN) / LON_STEP - 0.5))
    ri = int(round((lat - LAT_MIN) / LAT_STEP - 0.5))
    if ri < 0 or ri >= ROWS or ci < 0 or ci >= COLS:
        return None
    v = layers[LAST_DATE_INDEX][ri, ci]
    if np.isnan(v):
        return None
    return float(v)


def _add_area_by_level(pol, layers, lon_centers, lat_centers, parcel_map):
    """按承保面积累加 5 级面积。返回 (level_area dict, total)。"""
    level_area = {lv: 0.0 for lv in LEVELS}
    total = 0.0
    for cov in pol["coverage_list"]:
        parcel = parcel_map.get(cov["parcelId"])
        if not parcel:
            continue
        v = level_for_parcel(parcel, layers, lon_centers, lat_centers)
        if v is None:
            continue
        level_area[ndvi_level(v)] += cov["insuredAreaMu"]
        total += cov["insuredAreaMu"]
    return level_area, total


def compute_village_growth(villages, layers, lon_centers, lat_centers) -> dict:
    result = {}
    for code, name in INSURED_VILLAGES:
        fixture = load_policy_fixture(code)
        if not fixture:
            result[code] = {"name": name, "insuredAreaMu": 0, "householdCount": 0, "policyCount": 0,
                            "levels": {lv: 0 for lv in LEVELS}, "anomalyRatio": 0, "isAnomaly": False,
                            "countyCode": code[:6], "cityCode": code[:4] + "00",
                            "townshipCode": VILLAGE_PREFIX_TOWNSHIP.get(code[:9], ""), "data": False}
            continue
        pol = summarize_policy(fixture)
        parcels = load_parcels(code)
        level_area, total = _add_area_by_level(pol, layers, lon_centers, lat_centers, parcels)
        if total <= 0:
            result[code] = {"name": name, "insuredAreaMu": pol["insured_area"], "householdCount": pol["household_count"],
                            "policyCount": pol["policy_count"], "levels": {lv: 0 for lv in LEVELS},
                            "anomalyRatio": 0, "isAnomaly": False, "countyCode": code[:6],
                            "cityCode": code[:4] + "00", "townshipCode": VILLAGE_PREFIX_TOWNSHIP.get(code[:9], ""), "data": False}
            continue
        ratios = {lv: round(level_area[lv] / total, 4) for lv in LEVELS}
        anomaly_ratio = round(ratios["veryPoor"] + ratios["poor"], 4)
        result[code] = {
            "name": name, "insuredAreaMu": pol["insured_area"], "householdCount": pol["household_count"],
            "policyCount": pol["policy_count"], "levels": ratios, "anomalyRatio": anomaly_ratio,
            "isAnomaly": anomaly_ratio > ANOMALY_THRESHOLD,
            "countyCode": code[:6], "cityCode": code[:4] + "00",
            "townshipCode": VILLAGE_PREFIX_TOWNSHIP.get(code[:9], ""), "data": True,
        }
    return result


# ---------------------------------------------------------------------------
# 保单投保人名（无地块保单造名：团单用村集体/合作社名，大户用占位人名）
# ---------------------------------------------------------------------------

# 无地块大户：从常用农户姓名池按村码确定性取名（避免每次重跑变化）
_SURNAMES = ["王", "李", "张", "刘", "陈", "杨", "黄", "赵", "周", "吴", "徐", "孙", "朱", "马", "胡", "郭", "林", "何", "高", "罗"]
_GIVEN = ["建国", "志强", "秀兰", "桂英", "建华", "永福", "春梅", "德明", "国庆", "淑芬", "爱军", "丽华", "洪波", "玉珍", "国栋", "美玲", "俊杰", "桂芳", "世明", "桂香"]

def _pick(salt: str, pool: list[str]) -> str:
    idx = int(hashlib.md5(salt.encode("utf-8")).hexdigest(), 16) % len(pool)
    return pool[idx]

def insurer_name_for(insured_mode: str, village_code: str, policy_id: str, party_names: dict) -> str:
    """无地块保单的投保人名：团单→村集体/合作社名，大户→占位农户人名。"""
    if insured_mode == "insured_roster":
        return party_names.get("party-roster", "集体投保（团单）")
    # 单险种（大户）无地块：按村码+保单号确定性取一个农户名
    surname = _pick(f"s.{village_code}.{policy_id}", _SURNAMES)
    given = _pick(f"g.{village_code}.{policy_id}", _GIVEN)
    return surname + given


def compute_policy_growth(village_code, layers, lon_centers, lat_centers) -> list:
    fixture = load_policy_fixture(village_code)
    if not fixture:
        return []
    pol = summarize_policy(fixture)
    parcels = load_parcels(village_code)
    party_names = {str(p.get("id", "")): str(p.get("name", "")) for p in fixture.get("parties", [])}
    rows = []
    for policy in fixture.get("policies", []):
        pid = str(policy.get("id", ""))
        if policy.get("status") != "保障中":
            continue
        cov_subset = [c for c in pol["coverage_list"] if c["policyId"] == pid]
        pol_sub = {"coverage_list": cov_subset}
        level_area, total = _add_area_by_level(pol_sub, layers, lon_centers, lat_centers, parcels)
        if total > 0:
            ratios = {lv: round(level_area[lv] / total, 4) for lv in LEVELS}
        else:
            ratios = {lv: 0 for lv in LEVELS}
        insured_mode = str(policy.get("insuredMode", ""))
        insured_pid = str(policy.get("insuredPartyId", ""))
        insured_name = party_names.get(insured_pid, "")
        # 有地块 → 真实投保人名；无地块 → 团单用村集体/合作社名，大户用占位农户名
        if not insured_name:
            insured_name = insurer_name_for(insured_mode, village_code, pid, party_names)
        rows.append({
            "policyId": pid,
            "policyNo": str(policy.get("policyNo", pid)),
            "insuredMode": insured_mode,
            "insuredName": insured_name,
            "insuredPartyId": insured_pid,
            "insuredAreaMu": round(total, 2),
            "levels": ratios,
            "premiumRate": str(policy.get("premiumRate", "")),
        })
    return rows


# ---------------------------------------------------------------------------
# 任务/证据生成
# ---------------------------------------------------------------------------
def make_placeholder_image(path: Path, label: str, idx: int) -> None:
    w, h = 320, 220
    img = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(img)
    c1 = (74, 144, 226)
    c2 = (34, 84, 158)
    for y in range(h):
        t = y / h
        draw.line([(0, y), (w, y)], fill=(
            int(c1[0] + (c2[0] - c1[0]) * t), int(c1[1] + (c2[1] - c1[1]) * t), int(c1[2] + (c2[2] - c1[2]) * t)))
    draw.rectangle([16, 16, w - 16, h - 16], outline=(255, 255, 255), width=2)
    for i in range(1, 4):
        draw.line([(16 + i * (w - 32) / 4, 16), (16 + i * (w - 32) / 4, h - 16)], fill=(255, 255, 255), width=1)
    draw.text((w / 2 - 44, h / 2 - 12), label, fill=(255, 255, 255))
    draw.text((w / 2 - 30, h / 2 + 10), f"证据 {idx + 1}", fill=(255, 255, 255))
    img.save(path, format="PNG")


def generate_tasks(villages, village_growth) -> list:
    anomaly_villages = [(code, info) for code, info in village_growth.items() if info.get("isAnomaly")]
    tasks = []
    task_id = 1
    state_cycle = ["已完成", "进行中", "待下发", "待领取", "待下发", "进行中", "已完成", "待领取"]
    for code, info in anomaly_villages:
        rng = random.Random(stable_seed("task", code))
        type_key = rng.choice(["poor_growth", "poor_growth", "pesticide", "key_object"])
        tconf = ANOMALY_TYPES[type_key]
        count = rng.choice([1, 2])
        centroid = villages[code]["centroid"]
        for k in range(count):
            state = state_cycle[(task_id - 1) % len(state_cycle)]
            assigned = state in ("已完成", "进行中")
            staff = rng.choice(INSURANCE_STAFF) if assigned else None
            created_date = rng.choice(["2026-06-08", "2026-06-22", "2026-07-06", "2026-07-13", "2026-07-20"])
            lon = centroid["lon"] + rng.uniform(-0.004, 0.004)
            lat = centroid["lat"] + rng.uniform(-0.004, 0.004)
            ev_count = rng.choice([2, 3, 4])
            evidence = []
            for ei in range(ev_count):
                fname = f"{code}_{task_id}_{ei}.png"
                make_placeholder_image(EVIDENCE_DIR / fname, info["name"], ei)
                evidence.append({"url": f"/data/agri/evidence/{fname}", "time": created_date + f" 1{ei}:" + f"{ei:02d}"})
            tasks.append({
                "id": f"task-{task_id:04d}",
                "name": f"{info['name']}{tconf['name']}",
                "type": type_key, "typeName": tconf["name"],
                "villageCode": code, "villageName": info["name"],
                "status": state, "createdAt": created_date,
                "executor": staff, "remark": f"{info['name']}经遥感长势监测，异常面积占比约 {info['anomalyRatio']*100:.0f}%，需核查。",
                "sopAction": tconf["sop"], "requirement": tconf["requirement"],
                "location": {"name": info["name"], "lon": round(lon, 5), "lat": round(lat, 5)},
                "evidence": evidence,
            })
            task_id += 1
    return tasks


# ---------------------------------------------------------------------------
# 层级聚合（省/市/县/镇）
# ---------------------------------------------------------------------------
def build_level_aggregation(village_growth, manifest) -> dict:
    city_township_map = {}
    for city in manifest["cities"]:
        for county in city["counties"]:
            for tw in county["townships"]:
                city_township_map[tw["code"]] = {
                    "city_code": city["code"], "city_name": city["name"],
                    "county_code": county["code"], "county_name": county["name"],
                    "township_code": tw["code"], "township_name": tw["name"],
                }
    town_of_village = {}
    for code, _name in INSURED_VILLAGES:
        for pre, twc in VILLAGE_PREFIX_TOWNSHIP.items():
            if code.startswith(pre):
                town_of_village[code] = twc
                break

    def new_entry(code, name):
        return {"code": code, "name": name, "insuredAreaMu": 0, "householdCount": 0,
                "levels": {l: 0 for l in LEVELS}, "data": False}

    province = new_entry("330000", "浙江省")
    cities, counties, townships = {}, {}, {}

    def add_level(store, key, name, growth):
        entry = store.setdefault(key, new_entry(key, name))
        entry["insuredAreaMu"] += growth["insuredAreaMu"]
        entry["householdCount"] += growth["householdCount"]
        for l in LEVELS:
            entry["levels"][l] += growth["levels"][l] * growth["insuredAreaMu"]
        entry["data"] = True

    # 累积区域聚合（area 加权 5 级面积；归一化在结尾）
    def add_level(store, key, name, growth, direct=False):
        entry = store if direct else store.setdefault(key, new_entry(key, name))
        entry["insuredAreaMu"] += growth["insuredAreaMu"]
        entry["householdCount"] += growth["householdCount"]
        for l in LEVELS:
            entry["levels"][l] += growth["levels"][l] * growth["insuredAreaMu"]
        entry["data"] = True

    for code, growth in village_growth.items():
        if not growth.get("data"):
            continue
        tc = town_of_village.get(code)
        if not tc:
            continue
        tinfo = city_township_map.get(tc) or {
            "city_code": code[:4] + "00", "city_name": "浙江省",
            "county_code": code[:6], "county_name": code[:6],
            "township_code": tc, "township_name": tc,
        }
        add_level(province, "330000", "浙江省", growth, direct=True)
        add_level(cities, tinfo["city_code"], tinfo["city_name"], growth)
        add_level(counties, tinfo["county_code"], tinfo["county_name"], growth)
        add_level(townships, tc, tinfo["township_name"], growth)

    def normalize(entry):
        if entry["insuredAreaMu"] > 0:
            for l in LEVELS:
                entry["levels"][l] = round(entry["levels"][l] / entry["insuredAreaMu"], 4)
            entry["insuredAreaMu"] = round(entry["insuredAreaMu"], 2)
        else:
            entry["levels"] = {l: 0 for l in LEVELS}
            entry["data"] = False

    normalize(province)
    by_code = {"330000": province}
    for store in (cities, counties, townships):
        for entry in store.values():
            normalize(entry)
            by_code[entry["code"]] = entry
    return {"byCode": by_code}


# ---------------------------------------------------------------------------
# 写 NDVI 栅格
# ---------------------------------------------------------------------------
def write_ndvi(layers):
    """写稀疏点阵（仅省内单元格，NDVI 量化到 0.01），供前端重建值网格渲染热力图。"""
    lon_centers = LON_MIN + (np.arange(COLS) + 0.5) * LON_STEP
    lat_centers = LAT_MIN + (np.arange(ROWS) + 0.5) * LAT_STEP
    grid = []
    for r in range(ROWS):
        for c in range(COLS):
            first = layers[0][r, c]
            if np.isnan(first):
                continue
            vals = []
            for layer in layers:
                v = layer[r, c]
                vals.append(0 if (np.isnan(v)) else int(round(float(v) * 100)))
            grid.append({"lat": round(float(lat_centers[r]), 4), "lon": round(float(lon_centers[c]), 4), "values": vals})
    save_json(AGRI_DIR / "ndvi.json", {"dates": DATES, "grid": grid})


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    print("生成农情监测演示数据…")
    AGRI_DIR.mkdir(parents=True, exist_ok=True)
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

    print(" 加载村界 / 省界…")
    villages = load_village_boundaries()
    print("   参保村数:", len(villages))
    province_geom = load_province_geom()
    manifest = load_manifest()

    print(" 生成 NDVI 场…")
    layers, lon_centers, lat_centers = build_ndvi_field(villages, province_geom)

    print(" 写 NDVI 栅格…")
    write_ndvi(layers)

    print(" 计算村级 5 级占比 / 异常…")
    village_growth = compute_village_growth(villages, layers, lon_centers, lat_centers)
    save_json(AGRI_DIR / "villages.json", [
        {"code": code, "name": name, "centroid": villages[code]["centroid"],
         **{k: village_growth[code][k] for k in ["insuredAreaMu", "householdCount", "policyCount", "levels", "anomalyRatio", "isAnomaly", "countyCode", "cityCode", "townshipCode", "data"]}}
        for code, name in INSURED_VILLAGES
    ])

    print(" 计算保单维度长势…")
    for code, _name in INSURED_VILLAGES:
        save_json(AGRI_DIR / f"policy-growth-{code}.json", compute_policy_growth(code, layers, lon_centers, lat_centers))

    print(" 计算层级聚合（农情概况）…")
    save_json(AGRI_DIR / "levels.json", build_level_aggregation(village_growth, manifest))

    print(" 生成任务 / 证据…")
    save_json(AGRI_DIR / "tasks.json", generate_tasks(villages, village_growth))

    anomaly = [(c, i) for c, i in village_growth.items() if i.get("isAnomaly")]
    print(" 完成。异常村数:", len(anomaly))
    for code, info in anomaly:
        print(f"   异常村 {info['name']} anomalyRatio={info['anomalyRatio']:.0%} levels={info['levels']}")
    # 5 级占比分布校验
    for code, info in village_growth.items():
        print(f"  {info['name']}: area={info['insuredAreaMu']} lv={info['levels']}")
    # 全省栅格 5 级分布（最近一期，省内非空单元格）
    last = layers[LAST_DATE_INDEX]
    flat = last[~np.isnan(last)]
    print("\n 全省栅格(最近一期) NDVI 分布: min", round(float(flat.min()), 3), "max", round(float(flat.max()), 3),
          "mean", round(float(flat.mean()), 3))
    import collections
    lvl_count = collections.Counter(ndvi_level(float(v)) for v in flat)
    total = len(flat)
    for lv in LEVELS:
        print(f"   {lv}: {lvl_count.get(lv,0)} ({lvl_count.get(lv,0)/total:.1%})")


if __name__ == "__main__":
    main()

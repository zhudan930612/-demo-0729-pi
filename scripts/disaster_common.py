# -*- coding: utf-8 -*-
"""
受灾预警 V1 —— 数据管道公共模块（常量 / IO / 几何 / 名称归一化 / 确定性随机）

被 scripts/fetch_disaster_*.py、prepare_village_seats.py、generate_disaster_*.py 共享。
本模块不产生产物、不访问网络；可被单测直接 import。

数据契约见 docs/plans/受灾预警-V1-实施.md 第 6 节（冻结）。
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_PUBLIC = REPO_ROOT / "web" / "public"
DATA_DIR = WEB_PUBLIC / "data"
DISASTER_DIR = DATA_DIR / "disaster"
BUSINESS_DIR = WEB_PUBLIC / "business"
CACHE_DIR = REPO_ROOT / ".dev-runtime" / "disaster"          # 原始响应缓存（gitignored）
ZIP_DIR = REPO_ROOT / "01-行政区划" / "浙江四级边界加村点"
VILLAGES_DIR = DATA_DIR / "villages"
SERVER_ENV = REPO_ROOT / "server" / ".env.local"
GOV_SEATS = REPO_ROOT / "server" / "data" / "government-seats-v1.json"

# 影响窗口（北京时间）
WINDOW_START = "2026-07-09 00:00:00"
WINDOW_END = "2026-07-13 00:00:00"

# ERA5 拉取范围：浙江 0.25° 网格（21×19=399 请求点；吸附后去重 398 唯一节点）
LON_MIN, LON_MAX, LON_STEP = 118.0, 123.0, 0.25
LAT_MIN, LAT_MAX, LAT_STEP = 27.0, 31.5, 0.25
ARCHIVE_START, ARCHIVE_END = "2026-07-09", "2026-07-13"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

# 预警分级阈值（形态预检拍板：三档分明 + 峰值约1036村的方案 A，用户确认；校准留档见需求 C3）
THRESHOLDS = {"low": 170.0, "mid": 175.0, "high": 180.0}
# 滞回防抖：降级需连续 N 个节点低于当前档阈值才生效（升级立即生效）
HYSTERESIS_NODES = 2

# 名称归一化后缀（按长度从长到短剥离；长度 >2 才剥）
NAME_SUFFIXES = ["村民委员会", "社区居民委员会", "居委会", "村委会", "社区", "街道", "村", "组"]


def stable_seed(*parts: str) -> int:
    """确定性种子（与 scripts/generate-agri-monitoring.py 同约定）：sha256 前 16 hex。"""
    h = hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return int(h[:16], 16)


def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------------------
# 几何
# ---------------------------------------------------------------------------
def collect_rings(geometry: dict) -> list:
    """提取全部外环（MultiPolygon 每个 polygon 的外环 + Polygon 的外环）。"""
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"][0]]
    if geometry["type"] == "MultiPolygon":
        return [poly[0] for poly in geometry["coordinates"]]
    return []


def outer_ring(geometry: dict):
    """取最长的外环（面积最大的 polygon 的外环）。"""
    rings = collect_rings(geometry)
    return max(rings, key=len) if rings else None


def ring_centroid(ring) -> tuple:
    """环顶点坐标均值（vertex-mean，与形态预检基线同口径，用于 ERA5 格点归属）。"""
    lon = sum(p[0] for p in ring) / len(ring)
    lat = sum(p[1] for p in ring) / len(ring)
    return lon, lat


def simplify_ring(ring, maxn: int = 60):
    if len(ring) <= maxn:
        return ring
    step = math.ceil(len(ring) / maxn)
    return ring[::step]


def point_in_ring(x: float, y: float, ring) -> bool:
    """射线法判断点是否在外环内。"""
    c = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-15) + xi:
            c = not c
        j = i
    return c


def lon_scale(lat: float = 29.0) -> float:
    """把经纬度平面距离近似为 km 的系数（约 111km/度）。"""
    return 111.0


def km_between(lon1, lat1, lon2, lat2) -> float:
    dx = (lon2 - lon1) * 0.88 * 111.0
    dy = (lat2 - lat1) * 111.0
    return math.sqrt(dx * dx + dy * dy)


# ---------------------------------------------------------------------------
# 名称归一化
# ---------------------------------------------------------------------------
def norm_village_name(s: str) -> str:
    s = re.sub(r"[\s（）()·、\-—_]", "", s or "")
    for _ in range(3):
        for suf in NAME_SUFFIXES:
            if len(s) > 2 and s.endswith(suf):
                s = s[:-len(suf)]
                break
    return s


# ---------------------------------------------------------------------------
# 确定性伪随机（与 Python random 模块版本解耦，跨运行逐位一致）
# ---------------------------------------------------------------------------
def _rand01(seed: int) -> float:
    h = hashlib.sha256(str(seed).encode("utf-8")).hexdigest()
    return int(h[:13], 16) / (2 ** 52)


def _randn(seed: int) -> float:
    """Box-Muller 标准正态（两次均匀抽样）。"""
    u1 = _rand01(seed)
    u2 = _rand01(seed + 1)
    u1 = max(u1, 1e-12)
    return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


def lognormal(seed: int, mu: float, sigma: float) -> float:
    """确定性对数正态抽样。"""
    return math.exp(mu + sigma * _randn(seed))


# ---------------------------------------------------------------------------
# 预警等级判定（纯函数，可单测）
# ---------------------------------------------------------------------------
def tier_for_mm(mm: float, thresholds=None) -> int:
    """未来 24h 预报雨量 → 等级：0 无 / 1 低 / 2 中 / 3 高（阈值 130/160/185）。"""
    if not math.isfinite(mm):
        return 0
    th = thresholds or THRESHOLDS
    if mm >= th["high"]:
        return 3
    if mm >= th["mid"]:
        return 2
    if mm >= th["low"]:
        return 1
    return 0


def apply_hysteresis(raw_tiers, hysteresis_nodes=None) -> list:
    """对每村逐节点等级序列施加滞回防抖。

    规则（R3-21，用户确认）：
      - 升级立即生效；
      - 降级需连续 `hysteresis_nodes` 个节点低于当前档阈值才生效，
        每满足一次只降一级（高→中→低→无），避免阈值边界反复横跳。
    入参 raw_tiers: list[int]（0/1/2/3，节点序）。返回滞回后的等级序列。
    """
    n = hysteresis_nodes or HYSTERESIS_NODES
    state = 0
    below = 0
    out = []
    for r in raw_tiers:
        if r > state:
            state = r
            below = 0
        elif r < state:
            below += 1
            if below >= n:
                state = max(0, state - 1)
                below = 0
        else:
            below = 0
        out.append(state)
    return out


def load_manifest_townships() -> dict:
    """manifest.json → {乡镇码12位: {city, county, town, cityCode, countyCode}}。"""
    man = load_json(DATA_DIR / "manifest.json")
    out = {}
    for c in man["cities"]:
        for co in c["counties"]:
            for t in co.get("townships", []):
                out[t["code"]] = {
                    "city": c["name"], "county": co["name"], "town": t["name"],
                    "cityCode": c["code"], "countyCode": co["code"],
                }
    return out

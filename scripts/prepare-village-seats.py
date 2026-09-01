# -*- coding: utf-8 -*-
"""
受灾预警 V1 —— 村政府驻地点位空间连接（T1 / 契约 6.4 / R3-23）

源数据：01-行政区划/浙江四级边界加村点/*.zip 内 `村级/村位置_点数据_*.geojson`（共 25475 条；
`cuncode` 退化不可用、名称与村面属不同行政年代，名称三元组直连仅 46.3% —— 必须走空间连接）。

连接顺序（不可调换）：
  ① 点位落在村面内（多点位取距村面质心最近者）→ seat
  ② 同县+同乡归一化名称匹配（且距质心 <0.05°）→ name
  ③ 质心 1.5km 内最近点位 → nearest
  ④ 村面多边形质心兜底 → centroid

产物: web/public/data/disaster/village-seats.json（33898 村全量 + stats 占比）
基线（形态预检实测）：seat 52.4% / name 4.6% / nearest 26.9% / centroid 16.1%
"""
from __future__ import annotations

import argparse
import math
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from disaster_common import (  # noqa: E402
    DATA_DIR,
    DISASTER_DIR,
    VILLAGES_DIR,
    ZIP_DIR,
    load_json,
    load_manifest_townships,
    norm_village_name,
    outer_ring,
    point_in_ring,
    ring_centroid,
    save_json,
    simplify_ring,
)

try:
    from shapely.geometry import shape
    HAS_SHAPELY = True
except Exception:  # pragma: no cover
    HAS_SHAPELY = False

CELL = 0.02  # 点位空间网格（度）
NAME_RADIUS_DEG = 0.05  # 名称匹配允许半径（度）
NEAREST_KM = 1.5  # 近邻兜底半径（km）


class SeatError(Exception):
    pass


def load_village_points() -> list:
    """读取 11 个地市 zip 的村位置点数据 → [(xian,xiang,cun,lon,lat), ...]。"""
    points = []
    for f in sorted(ZIP_DIR.glob("*.zip")):
        with zipfile.ZipFile(f) as z:
            vp = [n for n in z.namelist() if "村位置" in n]
            if not vp:
                continue
            fc = json_load_bytes(z.read(vp[0]))
            for ft in fc["features"]:
                p = ft["properties"]
                lon, lat = ft["geometry"]["coordinates"]
                points.append((p["xian"], p["xiang"], p["cun"], float(lon), float(lat)))
    return points


def json_load_bytes(raw: bytes) -> dict:
    import json
    return json.loads(raw.decode("utf-8"))


def build_point_index(points: list) -> dict:
    """按 0.02° 网格索引点位：{(gx,gy): [idx,...]} + 归一化名称索引。"""
    grid = {}
    by_name = {}
    lons = [p[3] for p in points]
    lats = [p[4] for p in points]
    for i, (xian, xiang, cun, lon, lat) in enumerate(points):
        grid.setdefault((int(lon / CELL), int(lat / CELL)), []).append(i)
        by_name.setdefault((xian, xiang, norm_village_name(cun)), []).append(i)
    return {"grid": grid, "by_name": by_name, "lons": lons, "lats": lats}


def polygon_true_centroid(geometry: dict):
    """村面多边形质心兜底（shapely 质心；无 shapely 时退化为外环顶点均值）。"""
    if HAS_SHAPELY:
        try:
            g = shape(geometry)
            if g.is_valid and not g.is_empty:
                c = g.centroid
                return round(c.x, 6), round(c.y, 6)
        except Exception:
            pass
    ring = outer_ring(geometry)
    return (round(ring_centroid(ring)[0], 6), round(ring_centroid(ring)[1], 6)) if ring else (0.0, 0.0)


def join_seat(polygon_geometry: dict, village_name: str, township_key, idx: dict) -> tuple:
    """对一个村面执行四级连接，返回 (lon, lat, seatSource)。"""
    rings = []
    geom = polygon_geometry
    if geom["type"] == "Polygon":
        rings = [geom["coordinates"][0]]
    elif geom["type"] == "MultiPolygon":
        rings = [poly[0] for poly in geom["coordinates"]]
    outer = max(rings, key=len) if rings else None
    if not outer:
        raise SeatError("无有效外环")
    cl, ca = ring_centroid(outer)
    simp = simplify_ring(outer, 60)

    grid = idx["grid"]
    lons, lats = idx["lons"], idx["lats"]

    # ① 点位落在村面内（取距质心最近者）
    cand = set()
    for gx in range(int(min(p[0] for p in simp) / CELL), int(max(p[0] for p in simp) / CELL) + 1):
        for gy in range(int(min(p[1] for p in simp) / CELL), int(max(p[1] for p in simp) / CELL) + 1):
            cand.update(grid.get((gx, gy), []))
    hit = [i for i in cand if point_in_ring(lons[i], lats[i], simp)]
    if hit:
        best = min(hit, key=lambda i: (lons[i] - cl) ** 2 + (lats[i] - ca) ** 2)
        return lons[best], lats[best], "seat"

    # ② 同县同乡归一化名称匹配（且距质心 <0.05°）
    if township_key:
        by_name = idx["by_name"]
        m = by_name.get((township_key[0], township_key[1], norm_village_name(village_name)))
        if m:
            best = min(m, key=lambda i: (lons[i] - cl) ** 2 + (lats[i] - ca) ** 2)
            if (lons[best] - cl) ** 2 + (lats[best] - ca) ** 2 < NAME_RADIUS_DEG ** 2:
                return lons[best], lats[best], "name"

    # ③ 质心 1.5km 内最近点位
    best_d, best_i = 1e18, None
    for gx in range(int(cl / CELL) - 1, int(cl / CELL) + 2):
        for gy in range(int(ca / CELL) - 1, int(ca / CELL) + 2):
            for i in grid.get((gx, gy), []):
                dd = ((lons[i] - cl) * 0.88) ** 2 + (lats[i] - ca) ** 2
                if dd < best_d:
                    best_d, best_i = dd, i
    if best_i is not None and math.sqrt(best_d) * 111.0 < NEAREST_KM:
        return lons[best_i], lats[best_i], "nearest"

    # ④ 村面多边形质心兜底
    cl2, ca2 = polygon_true_centroid(geom)
    return cl2, ca2, "centroid"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="村政府驻地点位空间连接 -> village-seats.json")
    parser.add_argument("--out", type=str, default=str(DISASTER_DIR / "village-seats.json"))
    args = parser.parse_args(argv)

    points = load_village_points()
    print(f"点位源要素 {len(points)} 条")
    idx = build_point_index(points)
    townships = load_manifest_townships()

    seats, stats = [], {"seat": 0, "name": 0, "nearest": 0, "centroid": 0}
    total = 0
    for fn in sorted(VILLAGES_DIR.glob("*.geojson")):
        tc = fn.name[:12]
        tmeta = townships.get(tc)
        tkey = (tmeta["county"], tmeta["town"]) if tmeta else None
        fc = load_json(fn)
        for ft in fc["features"]:
            code = ft["properties"]["code"]
            name = ft["properties"]["name"]
            lon, lat, src = join_seat(ft["geometry"], name, tkey, idx)
            # center = 村面外环顶点均值（ERA5 格点归属用，与形态预检基线同口径）
            outer = outer_ring(ft["geometry"])
            cl, ca = ring_centroid(outer) if outer else (lon, lat)
            seats.append({"code": code, "name": name, "townshipCode": tc,
                          "cityCode": tmeta["cityCode"] if tmeta else code[:4] + "00",
                          "countyCode": tmeta["countyCode"] if tmeta else code[:6],
                          "centerLon": round(cl, 6), "centerLat": round(ca, 6),
                          "lon": round(lon, 6), "lat": round(lat, 6), "seatSource": src})
            stats[src] += 1
            total += 1
    stats_pct = {k: round(v / total * 100, 1) for k, v in stats.items()}
    out = Path(args.out)
    save_json(out, {"schemaVersion": 1, "total": total, "stats": stats_pct, "villages": seats})
    print(f"✅ village-seats.json 已写 {out}  共 {total} 村")
    print(f"   seat={stats_pct['seat']}% name={stats_pct['name']}% "
          f"nearest={stats_pct['nearest']}% centroid={stats_pct['centroid']}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

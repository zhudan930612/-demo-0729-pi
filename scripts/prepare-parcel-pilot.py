# -*- coding: utf-8 -*-
"""准备 Delineate Anything 龙江村试点输入，并将模型结果裁回村界/导出 GeoJSON。

用法：
  python scripts/prepare-parcel-pilot.py prepare
  python scripts/prepare-parcel-pilot.py export <模型输出.gpkg>

源影像、试点裁片、模型产物和前端 GeoJSON 均受 .gitignore 排除，不公开提交。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import rasterio
from rasterio.windows import Window, from_bounds
from rasterio.warp import transform_geom
from shapely.geometry import mapping, shape
from shapely.ops import transform as transform_shape
from pyproj import Geod, Transformer

ROOT = Path(__file__).resolve().parent.parent
VILLAGE_CODE = "330604102014"
TOWNSHIP_CODE = "330604104000"
SOURCE_TIF = ROOT / "05-遥感数据" / "JL1KF02B05_PMS02_20250402113627_200366490_101_0012_001_L3C_PSH.tif"
VILLAGES = ROOT / "web" / "public" / "data" / "villages" / f"{TOWNSHIP_CODE}.geojson"
WORK = ROOT / "05-遥感数据" / "parcel-pilot" / VILLAGE_CODE
INPUT = WORK / "images" / "Longjiang"
OUTPUT = WORK / "delineated"
TEMP = WORK / "temp"
FRONTEND = ROOT / "web" / "public" / "data" / "parcels" / f"{VILLAGE_CODE}.geojson"
BUFFER_M = 128
MIN_PARCEL_M2 = 200
MAX_PARCEL_M2 = 100_000
M2_PER_MU = 2000 / 3


def village_feature() -> dict:
    data = json.loads(VILLAGES.read_text(encoding="utf-8"))
    return next(f for f in data["features"] if f["properties"]["code"] == VILLAGE_CODE)


def write_crop(src: rasterio.DatasetReader, window: Window, out: Path) -> None:
    window = window.round_offsets().round_lengths()
    window = window.intersection(Window(0, 0, src.width, src.height))
    profile = src.profile.copy()
    profile.update(
        width=int(window.width),
        height=int(window.height),
        transform=src.window_transform(window),
        compress="deflate",
        tiled=True,
        blockxsize=512,
        blockysize=512,
        predictor=2,
        bigtiff="if_safer",
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out, "w", **profile) as dst:
        dst.write(src.read(window=window))
    print(f"写入 {out}: {int(window.width)}x{int(window.height)}")


def prepare() -> None:
    feature = village_feature()
    for p in (INPUT, OUTPUT, TEMP):
        p.mkdir(parents=True, exist_ok=True)

    with rasterio.open(SOURCE_TIF) as src:
        geom = transform_geom("EPSG:4326", src.crs, feature["geometry"], precision=3)
        minx, miny, maxx, maxy = shape(geom).bounds
        full_window = from_bounds(
            minx - BUFFER_M, miny - BUFFER_M, maxx + BUFFER_M, maxy + BUFFER_M,
            transform=src.transform,
        )
        write_crop(src, full_window, INPUT / "longjiang-buffered.tif")

        # 1536px 冒烟样本：先验证模型、权重和空间输出，不代表最终识别质量。
        cx, cy = shape(geom).centroid.coords[0]
        row, col = src.index(cx, cy)
        smoke = Window(col - 768, row - 768, 1536, 1536)
        smoke_dir = WORK / "images" / "Smoke"
        write_crop(src, smoke, smoke_dir / "smoke.tif")

    (WORK / "village.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": [feature]}, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"工作目录: {WORK}")


def parcel_properties(parcel_id: int, part, area_m2: float) -> dict:
    label_point = part.representative_point()
    return {
        "id": parcel_id,
        "area_m2": round(area_m2, 2),
        "area_mu": round(area_m2 / M2_PER_MU, 2),
        "label_lng": round(label_point.x, 7),
        "label_lat": round(label_point.y, 7),
    }


def enrich_frontend() -> None:
    """为现有前端地块补充面积和标注点，不改变 ID、顺序或几何。"""
    if not FRONTEND.exists():
        raise SystemExit(f"地块文件不存在: {FRONTEND}")
    data = json.loads(FRONTEND.read_text(encoding="utf-8"))
    geod = Geod(ellps="WGS84")
    for index, item in enumerate(data.get("features", []), start=1):
        part = shape(item["geometry"])
        area_m2 = abs(geod.geometry_area_perimeter(part)[0])
        parcel_id = item.get("properties", {}).get("id", index)
        item["properties"] = parcel_properties(parcel_id, part, area_m2)

    temp = FRONTEND.with_suffix(".geojson.tmp")
    temp.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temp.replace(FRONTEND)
    print(f"补充面积 {FRONTEND}: {len(data['features'])} 个地块, {FRONTEND.stat().st_size / 1024:.1f} KiB")


def _read_gpkg_geometries(gpkg: Path) -> tuple[list, int]:
    """用标准库 sqlite3 读取 GeoPackage 几何（GPKG BLOB → WKB → shapely），避免 fiona/GDAL 依赖。
    返回 (几何列表, srs_id)。"""
    import sqlite3
    import struct
    from shapely import from_wkb

    conn = sqlite3.connect(str(gpkg))
    try:
        cols = conn.execute(
            "SELECT table_name, column_name FROM gpkg_geometry_columns"
        ).fetchall()
        if not cols:
            raise ValueError(f"GeoPackage 缺少 gpkg_geometry_columns: {gpkg}")
        table_name, geom_col = cols[0]
        srs_row = conn.execute(
            "SELECT srs_id FROM gpkg_contents WHERE table_name=?", (table_name,)
        ).fetchone()
        srs_id = srs_row[0] if srs_row else 0
        blobs = conn.execute(f'SELECT "{geom_col}" FROM "{table_name}"').fetchall()
    finally:
        conn.close()

    def wkb_of(blob: bytes) -> bytes:
        # GPKG 几何 BLOB: 'GP' + version + flags + srs_id(4) + [envelope] + WKB。
        # envelope 长度随 writer 而异（OGR 可能写 2/3/4 个 double 且 flags 位编码不统一），
        # 故从 8 字节起递增探测第一个合法 WKB 起点（byteorder 00/01 + 有效几何类型）。
        if len(blob) < 9 or blob[0:2] != b"GP":
            return blob
        for hdr in range(8, min(len(blob) - 8, 48)):
            bo = blob[hdr]
            if bo not in (0, 1):
                continue
            wtype = struct.unpack("<I" if bo == 1 else ">I", blob[hdr + 1:hdr + 5])[0]
            if wtype in {1, 2, 3, 4, 5, 6, 7, 13, 15, 17, 18, 1000003}:
                return blob[hdr:]
        return blob

    geoms = []
    for (blob,) in blobs:
        if blob is None:
            continue
        geom = from_wkb(wkb_of(bytes(blob)))
        if geom is not None and not geom.is_empty:
            geoms.append(geom)
    return geoms, srs_id


def export(gpkg: Path) -> None:
    feature = village_feature()
    village = shape(feature["geometry"])
    geoms, srs_id = _read_gpkg_geometries(gpkg)
    if srs_id <= 0:
        raise ValueError(f"GeoPackage SRS 未知: {gpkg}")
    crs = f"EPSG:{srs_id}"
    transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    to_source = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    rows = []
    for geom in geoms:
        geom = transform_shape(transformer.transform, geom)
        clipped = geom.intersection(village)
        if clipped.is_empty:
            continue
        if clipped.geom_type == "Polygon":
            parts = [clipped]
        elif clipped.geom_type == "MultiPolygon":
            parts = list(clipped.geoms)
        else:
            continue
        for part in parts:
            area_m2 = transform_shape(to_source.transform, part).area
            if not MIN_PARCEL_M2 <= area_m2 <= MAX_PARCEL_M2:
                continue
            rows.append({
                "type": "Feature",
                "properties": parcel_properties(len(rows) + 1, part, area_m2),
                "geometry": mapping(part),
            })

    FRONTEND.parent.mkdir(parents=True, exist_ok=True)
    FRONTEND.write_text(
        json.dumps({"type": "FeatureCollection", "features": rows}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"导出 {FRONTEND}: {len(rows)} 个地块, {FRONTEND.stat().st_size / 1024:.1f} KiB")


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in {"prepare", "export", "enrich"}:
        raise SystemExit("用法: prepare-parcel-pilot.py prepare | export <结果.gpkg> | enrich")
    if sys.argv[1] == "prepare":
        prepare()
    elif sys.argv[1] == "enrich":
        enrich_frontend()
    else:
        if len(sys.argv) < 3:
            raise SystemExit("export 需要模型结果 GPKG 路径")
        export(Path(sys.argv[2]))

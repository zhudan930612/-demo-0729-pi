# -*- coding: utf-8 -*-
"""准备 Delineate Anything 试点裁片，并将模型结果裁回村界/导出 GeoJSON。

用法：
  python scripts/prepare-parcel-pilot.py prepare [--village 330604102014]
  python scripts/prepare-parcel-pilot.py export <模型输出.gpkg> [--village 330604102014]
  python scripts/prepare-parcel-pilot.py enrich [--village 330604102014]

源影像、试点裁片、模型产物和前端 GeoJSON 均受 .gitignore 排除，不公开提交。
多村化：--village 指定村代码（默认 330604102014 保持向后兼容）；村所属乡镇
自动从 web/public/data/villages/*.geojson 按 code 匹配（村码前缀 ≠ 乡镇码，
禁止前缀推导）。
"""
from __future__ import annotations

import argparse
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
DEFAULT_VILLAGE = "330604102014"
SOURCE_TIF = ROOT / "05-遥感数据" / "JL1KF02B05_PMS02_20250402113627_200366490_101_0012_001_L3C_PSH.tif"
VILLAGES_DIR = ROOT / "web" / "public" / "data" / "villages"
BUFFER_M = 128
MIN_PARCEL_M2 = 200
MAX_PARCEL_M2 = 100_000
M2_PER_MU = 2000 / 3


def find_village(code: str) -> tuple[Path, dict]:
    """按村代码在全部乡镇 villages 文件中匹配，返回 (乡镇文件路径, 村 feature)。"""
    if not VILLAGES_DIR.is_dir():
        raise SystemExit(f"villages 目录不存在: {VILLAGES_DIR}")
    matches = []
    for path in sorted(VILLAGES_DIR.glob("*.geojson")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for feature in data.get("features", []):
            if feature.get("properties", {}).get("code") == code:
                matches.append((path, feature))
    if not matches:
        raise SystemExit(f"在 villages 文件中未找到村代码: {code}")
    if len(matches) > 1:
        # 正常数据一个村只属于一个乡镇；若出现多个只警告并取第一个。
        print(f"警告: 村 {code} 在多个乡镇文件中出现，取 {matches[0][0].name}")
    return matches[0]


def village_name(code: str) -> str:
    _, feature = find_village(code)
    return str(feature.get("properties", {}).get("name", code))


def batch_dir_name(code: str) -> str:
    """Delineate Anything batch 子目录名。龙江村保持历史英文名 Longjiang（batch-longjiang.yaml
    与既有模型产物引用它），其余村统一使用村代码，避免中文路径与历史产物混淆。"""
    return "Longjiang" if code == "330604102014" else code


def paths_for(code: str) -> tuple[Path, Path, Path, Path, Path]:
    """按村代码派生 (work, input, output, temp, frontend) 路径。"""
    input_dir = ROOT / "05-遥感数据" / "parcel-pilot" / code / "images" / batch_dir_name(code)
    work = ROOT / "05-遥感数据" / "parcel-pilot" / code
    output = work / "delineated"
    temp = work / "temp"
    frontend = ROOT / "web" / "public" / "data" / "parcels" / f"{code}.geojson"
    return work, input_dir, output, temp, frontend


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


def prepare(code: str) -> None:
    _, feature = find_village(code)
    dir_name = batch_dir_name(code)
    work, input_dir, output, temp, _ = paths_for(code)
    for p in (input_dir, output, temp):
        p.mkdir(parents=True, exist_ok=True)

    with rasterio.open(SOURCE_TIF) as src:
        geom = transform_geom("EPSG:4326", src.crs, feature["geometry"], precision=3)
        minx, miny, maxx, maxy = shape(geom).bounds
        full_window = from_bounds(
            minx - BUFFER_M, miny - BUFFER_M, maxx + BUFFER_M, maxy + BUFFER_M,
            transform=src.transform,
        )
        write_crop(src, full_window, input_dir / f"{dir_name}-buffered.tif")

    (work / "village.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": [feature]}, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"工作目录: {work}")


def parcel_properties(parcel_id: int, part, area_m2: float) -> dict:
    label_point = part.representative_point()
    return {
        "id": parcel_id,
        "area_m2": round(area_m2, 2),
        "area_mu": round(area_m2 / M2_PER_MU, 2),
        "label_lng": round(label_point.x, 7),
        "label_lat": round(label_point.y, 7),
    }


def enrich_frontend(code: str) -> None:
    """为现有前端地块补充面积和标注点，不改变 ID、顺序或几何。"""
    _, _, _, _, frontend = paths_for(code)
    if not frontend.exists():
        raise SystemExit(f"地块文件不存在: {frontend}")
    data = json.loads(frontend.read_text(encoding="utf-8"))
    geod = Geod(ellps="WGS84")
    for index, item in enumerate(data.get("features", []), start=1):
        part = shape(item["geometry"])
        area_m2 = abs(geod.geometry_area_perimeter(part)[0])
        parcel_id = item.get("properties", {}).get("id", index)
        item["properties"] = parcel_properties(parcel_id, part, area_m2)

    temp = frontend.with_suffix(".geojson.tmp")
    temp.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temp.replace(frontend)
    print(f"补充面积 {frontend}: {len(data['features'])} 个地块, {frontend.stat().st_size / 1024:.1f} KiB")


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


def export(gpkg: Path, code: str) -> None:
    _, feature = find_village(code)
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

    _, _, _, _, frontend = paths_for(code)
    frontend.parent.mkdir(parents=True, exist_ok=True)
    frontend.write_text(
        json.dumps({"type": "FeatureCollection", "features": rows}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"导出 {frontend}: {len(rows)} 个地块, {frontend.stat().st_size / 1024:.1f} KiB")


def main() -> None:
    parser = argparse.ArgumentParser(description="Delineate Anything 村裁片准备与地块导出")
    parser.add_argument("command", choices=["prepare", "export", "enrich"])
    parser.add_argument("gpkg", nargs="?", default=None, help="export 时模型输出 GPKG 路径")
    parser.add_argument("--village", default=DEFAULT_VILLAGE, help=f"村代码（默认 {DEFAULT_VILLAGE}）")
    args = parser.parse_args()

    if args.command == "prepare":
        prepare(args.village)
    elif args.command == "enrich":
        enrich_frontend(args.village)
    else:
        if not args.gpkg:
            raise SystemExit("export 需要模型结果 GPKG 路径")
        export(Path(args.gpkg), args.village)


if __name__ == "__main__":
    main()

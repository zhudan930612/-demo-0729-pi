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
from pyproj import Transformer

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


def export(gpkg: Path) -> None:
    import fiona

    feature = village_feature()
    village = shape(feature["geometry"])
    rows = []
    with fiona.open(gpkg) as src:
        crs = src.crs_wkt or src.crs
        transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        to_source = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        for item in src:
            geom = transform_shape(transformer.transform, shape(item["geometry"]))
            clipped = geom.intersection(village)
            if clipped.is_empty:
                continue
            if clipped.geom_type == "Polygon":
                geoms = [clipped]
            elif clipped.geom_type == "MultiPolygon":
                geoms = list(clipped.geoms)
            else:
                continue
            for part in geoms:
                area_m2 = transform_shape(to_source.transform, part).area
                if not MIN_PARCEL_M2 <= area_m2 <= MAX_PARCEL_M2:
                    continue
                rows.append({
                    "type": "Feature",
                    "properties": {"id": len(rows) + 1},
                    "geometry": mapping(part),
                })

    FRONTEND.parent.mkdir(parents=True, exist_ok=True)
    FRONTEND.write_text(
        json.dumps({"type": "FeatureCollection", "features": rows}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"导出 {FRONTEND}: {len(rows)} 个地块, {FRONTEND.stat().st_size / 1024:.1f} KiB")


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in {"prepare", "export"}:
        raise SystemExit("用法: prepare-parcel-pilot.py prepare | export <结果.gpkg>")
    if sys.argv[1] == "prepare":
        prepare()
    else:
        export(Path(sys.argv[2]))

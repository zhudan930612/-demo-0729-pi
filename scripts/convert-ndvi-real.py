#!/usr/bin/env python3
"""把 GEE 导出的浙江 NDVI GeoTIFF（bbox，含邻省+海）转成前端结构化 ndvi.json。

- 输入：web/public/data/agri/gee-raw/zhejiang_ndvi_d1..d4.tif（EPSG:4326, ~224m）
- 处理：NW原点 reproject 到 0.003°(~330m) 网格 + geometry_mask 按省界裁剪 → 行反转成 lat 升序 → NDVI×100 整数(0=无数据)
- 输出：web/public/data/agri/ndvi.json（左下角 origin，lat 升序）
"""
from __future__ import annotations
import math, json
from pathlib import Path
import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling
from rasterio.features import geometry_mask
from shapely.geometry import shape

REPO = Path(__file__).resolve().parent.parent
RAW = REPO / "web/public/data/agri/gee-raw"
OUT = REPO / "web/public/data/agri"
PROV_GEO = REPO / "web/public/data/boundary/province.geojson"
CELL = 0.003
DATES = ["2025-06-15", "2025-07-15", "2025-08-15", "2025-09-20"]


def load_prov():
    return shape(json.load(open(PROV_GEO, encoding="utf-8"))["features"][0]["geometry"])


def main():
    prov = load_prov()
    lon0, lat0, lon1, lat1 = prov.bounds
    cols = int(math.ceil((lon1 - lon0) / CELL)); rows = int(math.ceil((lat1 - lat0) / CELL))
    # NW 原点 reproject（行0=北）
    nw_tr = from_origin(lon0, lat1, CELL, CELL)
    # 按省界掩膜（True=省内，与 NW 栅格同方向）
    mask = geometry_mask([prov], out_shape=(rows, cols), transform=nw_tr, invert=True)
    dst_crs = rasterio.crs.CRS.from_epsg(4326)
    layers = []
    for d in range(4):
        with rasterio.open(RAW / f"zhejiang_ndvi_d{d+1}.tif") as r:
            arr = r.read(1).astype("float32")
            nw = np.full((rows, cols), np.nan, dtype="float32")
            reproject(source=arr, destination=nw, src_transform=r.transform, src_crs=r.crs,
                      dst_transform=nw_tr, dst_crs=dst_crs, src_nodata=np.nan, dst_nodata=np.nan,
                      resampling=Resampling.bilinear)
        nw[~mask] = np.nan
        # 行反转 → lat 升序（行0=南）。存 originLat=lat0
        nw = nw[::-1]
        flat = nw.ravel()
        layer = np.where(np.isfinite(flat), (np.clip(flat, 0, 0.95) * 100).round().astype(int), 0)
        layers.append(layer.tolist())
        print(f"d{d+1}: 有效格 {int((np.array(layer) > 0).sum())} / {cols * rows}")
    payload = {
        "originLon": lon0, "originLat": lat0, "stepLon": CELL, "stepLat": CELL,
        "cols": cols, "rows": rows, "dates": DATES, "layers": layers,
    }
    out = OUT / "ndvi.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print("saved", out, f"({out.stat().st_size/1e6:.1f} MB)", "cols", cols, "rows", rows)


if __name__ == "__main__":
    main()

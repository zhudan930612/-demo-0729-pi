# -*- coding: utf-8 -*-
"""
吉林一号 TIF -> XYZ 瓦片 (z15~z19)
- UTM/WGS84 重投影到 EPSG:3857 (rasterio WarpedVRT)
- 波段顺序 B,G,R,NIR -> 取 3,2,1 为 RGB
- 16bit -> 8bit: 每波段 2%~98% 线性拉伸
- 黑边(nodata=0) -> 透明
产物: web/public/tiles/rs/{z}/{x}/{y}.png + web/public/data/rs.json
"""
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.vrt import WarpedVRT
from rasterio.warp import Resampling, transform_bounds

ROOT = Path(__file__).resolve().parent.parent
TIF = ROOT / '05-遥感数据' / 'JL1KF02B05_PMS02_20250402113627_200366490_101_0012_001_L3C_PSH.tif'
TILES = ROOT / 'web' / 'public' / 'tiles' / 'rs'
RS_JSON = ROOT / 'web' / 'public' / 'data' / 'rs.json'

Z_MIN, Z_MAX = 13, 19
READ_RES = 0.5          # 重投影后读取分辨率(米/像素), 与影像 GSD 一致
ORIGIN = 20037508.342789244  # EPSG:3857 半周长
BANDS_RGB = [3, 2, 1]   # B,G,R,NIR -> R,G,B


def tile_pixel_size(z, lat):
    return 156543.03392 * math.cos(math.radians(lat)) / (2 ** z)


def meter_to_tile(mx, my, z):
    n = 2 ** z
    ts = 2 * ORIGIN / n
    return math.floor((mx + ORIGIN) / ts), math.floor((ORIGIN - my) / ts)


def main():
    src = rasterio.open(TIF)
    print(f'源: {src.width}x{src.height}, {src.count}波段, {src.crs}, dtype={src.dtypes[0]}')

    # 1) 统计: 降采样读取算 2/98 百分位 (忽略 nodata=0)
    small = src.read(BANDS_RGB, out_shape=(3, src.height // 20, src.width // 20)).astype(np.float32)
    p_lo, p_hi = [], []
    for b in range(3):
        v = small[b][small[b] > 0]
        lo, hi = np.percentile(v, [2, 98])
        p_lo.append(float(lo))
        p_hi.append(float(hi))
    print(f'拉伸区间: {list(zip(p_lo, p_hi))}')
    del small

    # 2) 重投影到 3857, 一次性读入 8bit 大图
    vrt = WarpedVRT(src, crs='EPSG:3857', resampling=Resampling.bilinear)
    west, south, east, north = vrt.bounds
    cx_lat = transform_bounds('EPSG:3857', 'EPSG:4326', west, south, east, north)
    mid_lat = (cx_lat[1] + cx_lat[3]) / 2
    w = int((east - west) / READ_RES)
    h = int((north - south) / READ_RES)
    print(f'3857范围: {w}x{h}px @0.5m, 中心纬度 {mid_lat:.3f}')
    data = vrt.read(BANDS_RGB, out_shape=(3, h, w)).astype(np.float32)
    alpha = (data.sum(axis=0) > 0).astype(np.uint8) * 255
    for b in range(3):
        np.clip((data[b] - p_lo[b]) / (p_hi[b] - p_lo[b]) * 255, 0, 255, out=data[b])
    rgb = data.astype(np.uint8)  # (3,h,w)
    print('大图读取完成, 开始切片...')

    # 3) 切片
    total = 0
    for z in range(Z_MIN, Z_MAX + 1):
        n = 2 ** z
        ts_m = 2 * ORIGIN / n        # 每瓦片边长(米)
        win = ts_m / READ_RES        # 每瓦片对应大图的像素数
        to_tile = 256 / win          # 大图像素 -> 瓦片像素 的换算
        tx0, ty0 = meter_to_tile(west, north, z)
        tx1, ty1 = meter_to_tile(east, south, z)
        cnt = 0
        for tx in range(tx0, tx1 + 1):
            for ty in range(ty0, ty1 + 1):
                tw = tx * ts_m - ORIGIN          # 瓦片西边界(米)
                tn = ORIGIN - ty * ts_m          # 瓦片北边界(米)
                # 瓦片在大图中的浮点像素窗口
                px0 = (tw - west) / READ_RES
                py0 = (north - tn) / READ_RES
                # 大图内有效裁剪区
                cx0, cy0 = max(int(math.floor(px0)), 0), max(int(math.floor(py0)), 0)
                cx1 = min(int(math.ceil(px0 + win)), w)
                cy1 = min(int(math.ceil(py0 + win)), h)
                if cx1 <= cx0 or cy1 <= cy0:
                    continue
                region = Image.fromarray(
                    np.dstack([rgb[:, cy0:cy1, cx0:cx1].transpose(1, 2, 0),
                               alpha[cy0:cy1, cx0:cx1]]), 'RGBA')
                region = region.resize(
                    (max(1, round((cx1 - cx0) * to_tile)),
                     max(1, round((cy1 - cy0) * to_tile))),
                    Image.LANCZOS)
                tile = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
                tile.paste(region, (round((cx0 - px0) * to_tile),
                                    round((cy0 - py0) * to_tile)))
                arr = np.asarray(tile)
                if arr[:, :, 3].max() == 0:
                    continue
                out = TILES / str(z) / str(tx) / f'{ty}.png'
                out.parent.mkdir(parents=True, exist_ok=True)
                tile.save(out)
                cnt += 1
        total += cnt
        print(f'  z{z}: {cnt} 瓦片')
    print(f'共 {total} 瓦片')

    RS_JSON.parent.mkdir(parents=True, exist_ok=True)
    RS_JSON.write_text(json.dumps({
        'bounds': [round(v, 6) for v in cx_lat],  # [w, s, e, n] EPSG:4326
        'minZoom': Z_MIN, 'maxZoom': Z_MAX,
    }, ensure_ascii=False), encoding='utf-8')
    print(f'rs.json: {RS_JSON}')


if __name__ == '__main__':
    main()

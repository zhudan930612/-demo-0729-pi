#!/usr/bin/env python3
"""农情监测——形态预检：渲染 NDVI 场为彩色热力图 PNG（目视确认自然性/5级分布/时空过渡）。"""
import importlib.util
import sys
from pathlib import Path
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location("A", "scripts/generate-agri-monitoring.py")
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)

OUT = Path("scripts/agri-preview")
OUT.mkdir(parents=True, exist_ok=True)

# 5 级颜色（极差/较差/正常/较好/极好）——与前端图例一致
LEVEL_COLORS = {
    "veryPoor": (153, 27, 27),   # 深红
    "poor": (234, 88, 12),       # 橙
    "normal": (250, 204, 21),    # 黄
    "good": (34, 197, 94),       # 绿
    "excellent": (16, 122, 87),  # 深绿
}

def color_for(value):
    lv = A.ndvi_level(value)
    return LEVEL_COLORS[lv]

def render(layers, names, fname):
    # 生成一张横向拼图：每个日期一列
    last = layers[0]
    rows, cols = last.shape
    n = len(layers)
    scale = 2  # 放大便于查看
    img = Image.new("RGB", (cols * scale * n, rows * scale), (245, 245, 245))
    px = img.load()
    for di, layer in enumerate(layers):
        for r in range(rows):
            for c in range(cols):
                v = layer[r, c]
                if np.isnan(v):
                    col = (245, 245, 245)
                else:
                    col = color_for(float(v))
                for sy in range(scale):
                    for sx in range(scale):
                        x = c * scale + sx + di * cols * scale
                        y = r * scale + sy
                        px[x, y] = col
    img.save(OUT / fname)
    print("saved", OUT / fname)

villages = A.load_village_boundaries()
prov = A.load_province_geom()
layers, lons, lats = A.build_ndvi_field(villages, prov)
render([layers[0], layers[3], layers[A.LAST_DATE_INDEX]], None, "ndvi-dates.png")

# 统计每个日期全省 5 级占比
import collections
for di in [0, 3, A.LAST_DATE_INDEX]:
    flat = layers[di][~np.isnan(layers[di])]
    cnt = collections.Counter(A.ndvi_level(float(v)) for v in flat)
    tot = len(flat)
    print(f"日期{di}: min={flat.min():.3f} max={flat.max():.3f} " +
          " ".join(f"{k}={cnt.get(k,0)/tot:.1%}" for k in A.LEVELS))

# 村级空间变化（龙江村子网格）
code = "330604102014"
info = villages[code]
alllon = [c[0] for poly in info["polygons"] for c in poly.exterior.coords]
alllat = [c[1] for poly in info["polygons"] for c in poly.exterior.coords]
ci0 = int((min(alllon) - A.LON_MIN) / A.LON_STEP); ci1 = int((max(alllon) - A.LON_MIN) / A.LON_STEP)
ri0 = int((min(alllat) - A.LAT_MIN) / A.LAT_STEP); ri1 = int((max(alllat) - A.LAT_MIN) / A.LAT_STEP)
print("龙江村子网格 value rows (最近一期):")
sub = layers[A.LAST_DATE_INDEX][ri0:ri1 + 1, ci0:ci1 + 1]
for row in sub:
    print(" ".join(f"A[{A.ndvi_level(float(v))[0]}]" if not np.isnan(v) else " . " for v in row))

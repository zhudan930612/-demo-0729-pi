#!/usr/bin/env python3
"""重算【全部市/县/镇】农情概况聚合（levels）——真实 NDVI 按区域聚合 5级占比 + 无保单区域造面积/户数。

- 输入：web/public/data/agri/ndvi.json（真实 224m）+ 行政边界 geojson（province/city/county/township）+ 13 参保村保单
- 处理：
   * 每个市/县/镇：真实 NDVI 按区域聚合 → 5级占比(每期)；农田面积 → 造承保面积(farm×0.5)/户数(面积÷10)
   * 13 参保村所属的省/绍兴市/上虞区/嵊州市/章镇镇/三界镇：用真实保单汇总（覆盖造值）
- 输出：web/public/data/agri/agri-business.json 中的 levels（byCode 每期，含全部市/县/镇）
"""
from __future__ import annotations
import importlib.util, json, math
from pathlib import Path
import numpy as np
from shapely.geometry import shape
from shapely.vectorized import contains as scontains

REPO = Path(__file__).resolve().parent.parent
AGRI = REPO / "web/public/data/agri"
BOUND = REPO / "web/public/data/boundary"
spec = importlib.util.spec_from_file_location("G", REPO / "scripts/generate-agri-monitoring.py")
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)

# ---- 真实 NDVI 栅格 ----
ndvi = json.load(open(AGRI / "ndvi.json", encoding="utf-8"))
origin_lon, origin_lat = ndvi["originLon"], ndvi["originLat"]
step_lon, step_lat = ndvi["stepLon"], ndvi["stepLat"]
cols, rows = ndvi["cols"], ndvi["rows"]
DATES = ndvi["dates"]
layers = [np.array(ndvi["layers"][d], dtype="float32").reshape(rows, cols) for d in range(len(DATES))]
lon_centers = origin_lon + (np.arange(cols) + 0.5) * step_lon
lat_centers = origin_lat + (np.arange(rows) + 0.5) * step_lat
MU = 666.667  # 1亩 = 666.667 平方米
cellAreaMu = step_lon * 111000 * math.cos(math.radians(29)) * step_lat * 111000 / MU  # 每格(约 81 亩)
COVERAGE = 0.08  # 无保单区域：耕地 × 8% ≈ 投保规模
PER_HOUSEHOLD_MU = 10
REAL_PROVINCE_GENGMU = 1935.70  # 浙江省耕地总面积(三调2019, 万亩, 真实)

# 各设区市耕地(万亩)：查到的锚点（杭州/绍兴/温州）+ 按农业特征预估其余，再归一化到省总量
CITY_GENGMU = {
    "330100": 310, "330200": 250, "330300": 330, "330400": 260, "330500": 180,
    "330600": 178, "330700": 200, "330800": 180, "330900": 25, "331000": 230, "331100": 100,
}


def aggregate_regions(dates_levels):
    """对单一几何：按每期 NDVI 区域内聚合 5级占比 + 农田面积(亩)。"""
    def agg(geom):
        bbox = geom.bounds
        ci0 = max(0, int((bbox[0] - origin_lon) / step_lon)); ci1 = min(cols - 1, int((bbox[2] - origin_lon) / step_lon))
        ri0 = max(0, int((bbox[1] - origin_lat) / step_lat)); ri1 = min(rows - 1, int((bbox[3] - origin_lat) / step_lat))
        if ci1 < ci0 or ri1 < ri0:
            return None
        lons = lon_centers[ci0:ci1 + 1]; lats = lat_centers[ri0:ri1 + 1]
        LO, LA = np.meshgrid(lons, lats)
        mask = scontains(geom, LO, LA)
        if not mask.any():
            return None
        _dates = []
        farmland_cells = 0
        for di in range(len(layers)):
            sub = layers[di][ri0:ri1 + 1, ci0:ci1 + 1]
            vals = sub[mask]
            vals = vals[vals > 0]
            if vals.size == 0:
                _dates.append({lv: 0.0 for lv in G.LEVELS})
                continue
            cnt = {lv: 0 for lv in G.LEVELS}
            for v in vals:
                cnt[G.ndvi_level(float(v) / 100.0)] += 1  # ndvi.json 存 NDVI×100 整数
            _dates.append({lv: round(cnt[lv] / vals.size, 4) for lv in G.LEVELS})
            if di == 0:
                farmland_cells = int((sub[mask] / 100.0 >= 0.4).sum())
        return {"levels": _dates, "farmAreaMu": round(farmland_cells * cellAreaMu, 2)}
    return agg


def load_regions():
    """加载全部市/县/镇（含几何）：city_file → cities; county_file → counties; township_file → townships。"""
    regions = {}  # code -> (name, geometry)
    # 市
    fc = json.load(open(BOUND / "city" / "330000.geojson", encoding="utf-8"))
    for f in fc["features"]:
        regions[str(f["properties"]["code"])] = (str(f["properties"]["name"]), shape(f["geometry"]))
    # 县：每市一个 county geojson
    for city_code, (_, _g) in list(regions.items()):
        if len(city_code) != 6:  # 市码 6 位
            continue
        cfile = BOUND / "county" / f"{city_code}.geojson"
        if not cfile.exists():
            continue
        cf = json.load(open(cfile, encoding="utf-8"))
        for f in cf.get("features", []):
            code = str(f["properties"]["code"])
            regions.setdefault(code, (str(f["properties"]["name"]), shape(f["geometry"])))
    # 镇：用 manifest 的县码 → township/{county}.geojson
    manifest = G.load_manifest()
    for city in manifest["cities"]:
        for county in city["counties"]:
            tfile = BOUND / "township" / f"{county['code']}.geojson"
            if not tfile.exists():
                continue
            tf = json.load(open(tfile, encoding="utf-8"))
            for f in tf.get("features", []):
                tcode = str(f["properties"]["code"])
                regions[tcode] = (str(f["properties"]["name"]), shape(f["geometry"]))
    return regions


def fabricate(agg, scale):
    """造承保面积 = 耕地(区域NDVI农田×缩放到省真实总量) × 覆盖率；户数 = 面积 / 每户。"""
    gengmu = agg["farmAreaMu"] * scale  # 区域内耕地(亩)
    area = round(gengmu * COVERAGE, 2)
    return area, max(1, int(area / PER_HOUSEHOLD_MU))


def build_levels_by_date():
    regions = load_regions()
    agg_fn = aggregate_regions(None)
    # 首遍：聚合全部区域 → 各区域 NDVI 农田面积(用于县/镇逐级拆分的相对分布)
    agg_by_code = {}
    for code, (name, geom) in regions.items():
        a = agg_fn(geom)
        if a is not None:
            agg_by_code[code] = a
    # 归一化市耕地到省真实总量
    city_codes = {str(c["code"]) for c in G.load_manifest()["cities"]}
    sum_city = sum(CITY_GENGMU.get(c, 0) for c in city_codes)
    city_scale = REAL_PROVINCE_GENGMU / sum_city if sum_city > 0 else 1.0
    print(f"  市耕地归一化系数 {city_scale:.4f} → 省真实耕地 {REAL_PROVINCE_GENGMU}万亩")
    # 建立县/镇 → 父级 code 映射（来自 manifest）
    parent_of = {}
    city_gengmu = {}
    for city in G.load_manifest()["cities"]:
        cc = str(city["code"])
        city_gengmu[cc] = CITY_GENGMU.get(cc, 0) * city_scale
        for county in city.get("counties", []):
            ccode = str(county["code"])
            parent_of[ccode] = cc
            for twp in county.get("townships", []):
                parent_of[str(twp["code"])] = ccode
    print(f"  县/镇父级映射 {len(parent_of)} 条；市耕地示例 { {k: round(v,1) for k,v in list(city_gengmu.items())[:3]} }")

    # 真实保单（13 参保村，用于覆盖层级）
    village_growth = {}
    for code, name in G.INSURED_VILLAGES:
        fixture = G.load_policy_fixture(code)
        if fixture:
            village_growth[code] = G.summarize_policy(fixture)
    # 逐级拆分耕地：镇 = 县 × (镇NDVI/县NDVI)；县 = 市 × (县NDVI/市NDVI)；市 = 锚点
    # 先按层级顺序（市>县>镇）生成每区域耕地(亩)
    geng_by_code = {}  # code -> 耕地(亩)
    for c in city_codes:
        if c in city_gengmu:
            geng_by_code[c] = city_gengmu[c] * 10000  # 万亩→亩
    # 县：用县NDVI/市NDVI 拆分市耕地
    for code, pcode in parent_of.items():
        if len(code) == 6 and pcode in geng_by_code:  # 县(6位)
            p = agg_by_code.get(pcode); a = agg_by_code.get(code)
            if p and a and p["farmAreaMu"] > 0:
                geng_by_code[code] = geng_by_code[pcode] * (a["farmAreaMu"] / p["farmAreaMu"])
    # 镇(12位)：用镇NDVI/县NDVI 拆分县耕地
    for code, pcode in parent_of.items():
        if len(code) == 12 and pcode in geng_by_code:
            p = agg_by_code.get(pcode); a = agg_by_code.get(code)
            if p and a and p["farmAreaMu"] > 0:
                geng_by_code[code] = geng_by_code[pcode] * (a["farmAreaMu"] / p["farmAreaMu"])
    print(f"  TODO 已拆分区域耕地 {len(geng_by_code)} 个")

    # 真实每期层级（来自 recompute-agri-business.py：13参保村/6 insured区域），先复制；再补造值区域
    existing = json.load(open(AGRI / "agri-business.json", encoding="utf-8")) if (AGRI / "agri-business.json").exists() else {}
    levels_by_date = [dict(d["byCode"]) for d in existing.get("levels", [])]
    for code, (name, geom) in regions.items():
        if any(code in rb for rb in levels_by_date):
            continue
        a = agg_by_code.get(code); geng = geng_by_code.get(code)
        if a is None or geng is None:
            continue
        area = round(geng * COVERAGE, 2)
        hh = max(1, int(area / PER_HOUSEHOLD_MU))
        for di in range(len(DATES)):
            levels_by_date[di][code] = {"code": code, "name": name, "insuredAreaMu": area,
                                        "householdCount": hh, "levels": a["levels"][di], "data": True}
    return levels_by_date


def main():
    levels_by_date = build_levels_by_date()
    # 省(330000) 承保面积/户数 = 各市之和（确保 省 > 市，层级连贯）；5级占比保留真实13村
    manifest = G.load_manifest()
    city_codes = [str(c["code"]) for c in manifest["cities"]]
    for di in range(len(DATES)):
        rb = levels_by_date[di]
        if "330000" in rb:
            prov = rb["330000"]
            area_sum = sum(rb[c]["insuredAreaMu"] for c in city_codes if c in rb)
            hh_sum = sum(rb[c]["householdCount"] for c in city_codes if c in rb)
            prov["insuredAreaMu"] = round(area_sum, 2)
            prov["householdCount"] = hh_sum
            # 省5级占比 = 各市承保面积加权聚合 → 保证省市一致（省极差不因真实13村口径而漏掉市级极差）
            lv_sum = {lv: 0.0 for lv in G.LEVELS}
            for c in city_codes:
                if c in rb:
                    a = rb[c]["insuredAreaMu"]
                    for lv in G.LEVELS:
                        lv_sum[lv] += rb[c]["levels"].get(lv, 0) * a
            if area_sum > 0:
                prov["levels"] = {lv: round(lv_sum[lv] / area_sum, 4) for lv in G.LEVELS}
    payload = {"dates": DATES, "byCode": levels_by_date}
    # 读现有 agri-business.json（保留 villages/policyGrowth/tasks），替换 levels
    existing = json.load(open(AGRI / "agri-business.json", encoding="utf-8")) if (AGRI / "agri-business.json").exists() else {}
    # levels: 每期 {byCode}
    existing["levels"] = [{"byCode": levels_by_date[di]} for di in range(len(DATES))]
    existing.setdefault("dates", DATES)
    with open(AGRI / "agri-business.json", "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, separators=(",", ":"))
    print("✓ agri-business.json (levels 含全部市/县/镇)")
    print("  各期 byCode 条数:", [len(levels_by_date[di]) for di in range(len(DATES))])
    # 打印非参保城市样例
    for code in ["330100", "330200", "330300"]:
        if code in levels_by_date[0]:
            e = levels_by_date[0][code]
            print(f"  {e['name']}: area={e['insuredAreaMu']} 户={e['householdCount']} lv={e['levels']}")


if __name__ == "__main__":
    main()

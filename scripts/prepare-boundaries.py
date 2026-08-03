# -*- coding: utf-8 -*-
"""
边界预处理:
  1. 解压 11 个地市 zip -> 按层级拆分 GeoJSON（剥离冗余 geom WKB 属性）
  2. 村界 SHP -> 按乡镇码拆分 villages/{乡镇码}.geojson（简化 ~1m 精度）
  3. 生成 manifest.json（五级层级树，仅 code+name）
  4. 生成 weather/index-v1.json（服务端可信父子关系、面内代表点与边界引用）
产物: web/public/data/
  boundary/province.geojson
  boundary/city/330000.geojson
  boundary/county/{cityCode}.geojson
  boundary/township/{countyCode}.geojson
  villages/{townshipCode}.geojson
  manifest.json
"""
import json
import shutil
import sys
import zipfile
from pathlib import Path

import shapefile  # pyshp
from shapely.geometry import GeometryCollection, mapping, shape
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely import make_valid, simplify as shp_simplify

from weather_spatial_index import write_weather_spatial_index

ROOT = Path(__file__).resolve().parent.parent
ZIP_DIR = ROOT / '01-行政区划' / '浙江四级边界加村点'
SHP_PATH = ROOT / '01-行政区划' / '浙江村界数据' / '3浙江村界-备注省市县乡' / '浙江村界.shp'
OUT = ROOT / 'web' / 'public' / 'data'

PROVINCE_GEOJSON = ZIP_DIR / '330000-浙江省-省界.geojson'

# 简化容差(度): 1e-5 ≈ 1m
TOL_BOUNDARY = 2e-5   # 市/县/乡 展示缩放级别较低, 2m 足够
TOL_VILLAGE = 1e-5    # 村界 ~1m (决策#15)
COORD_DP = 6          # 坐标保留小数位 (~0.1m)


def round_coords(coords, dp=COORD_DP):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], dp), round(coords[1], dp)]
    return [round_coords(c, dp) for c in coords]


def normalize_polygonal_geometry(geom, reference):
    """修复源几何并在坐标圆整后再次校验，输出可用于授权的最终面几何。"""
    if geom.is_empty:
        raise ValueError(f'空几何: {reference}')
    if not geom.is_valid:
        geom = make_valid(geom)
    if isinstance(geom, GeometryCollection):
        polygonal = [part for part in geom.geoms if part.geom_type in {'Polygon', 'MultiPolygon'}]
        geom = unary_union(polygonal) if polygonal else geom
    if geom.geom_type not in {'Polygon', 'MultiPolygon'} or geom.is_empty or not geom.is_valid:
        raise ValueError(f'无法修复为有效面几何: {reference}')

    rounded = mapping(geom)
    rounded['coordinates'] = round_coords(rounded['coordinates'])
    geom = shape(rounded)
    if not geom.is_valid:
        geom = make_valid(geom)
        if isinstance(geom, GeometryCollection):
            polygonal = [part for part in geom.geoms if part.geom_type in {'Polygon', 'MultiPolygon'}]
            geom = unary_union(polygonal) if polygonal else geom
    if geom.geom_type not in {'Polygon', 'MultiPolygon'} or geom.is_empty or not geom.is_valid:
        raise ValueError(f'坐标圆整后无法得到有效面几何: {reference}')
    return geom


def clean_feature(feature, code_key, name_key, tol):
    """提取 code/name, 剥离冗余属性, 简化、修复并圆整为最终可信面。"""
    props = feature['properties']
    code = str(props[code_key]).strip()
    geom = shape(feature['geometry'])
    if tol:
        geom = shp_simplify(geom, TOL_BOUNDARY if tol == 'boundary' else TOL_VILLAGE,
                            preserve_topology=True)
    geom = normalize_polygonal_geometry(geom, code)
    g = mapping(geom)
    return {
        'type': 'Feature',
        'properties': {'code': code, 'name': str(props[name_key]).strip()},
        'geometry': g,
    }


def write_geojson(path, features):
    path.parent.mkdir(parents=True, exist_ok=True)
    fc = {'type': 'FeatureCollection', 'features': features}
    path.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def process_zip_boundaries():
    """四级边界 -> 层级拆分; 返回 manifest 城市树"""
    manifest = {'province': {'code': '330000', 'name': '浙江省'}, 'cities': []}

    # 省界
    pgj = json.loads(PROVINCE_GEOJSON.read_text(encoding='utf-8'))
    prov_feat = clean_feature(pgj['features'][0], '省级码', '省', 'boundary')
    write_geojson(OUT / 'boundary' / 'province.geojson', [prov_feat])

    all_cities = []
    for zp in sorted(ZIP_DIR.glob('33*-GeoJSON.zip')):
        with zipfile.ZipFile(zp) as z:
            names = z.namelist()
            city_file = [n for n in names if n.startswith('市级/')][0]
            county_file = [n for n in names if n.startswith('县级/')][0]
            town_file = [n for n in names if n.startswith('乡镇/')][0]

            city_gj = json.loads(z.read(city_file).decode('utf-8'))
            county_gj = json.loads(z.read(county_file).decode('utf-8'))
            town_gj = json.loads(z.read(town_file).decode('utf-8'))

            city_feat = clean_feature(city_gj['features'][0], '区划码', '地名', 'boundary')
            city_code, city_name = city_feat['properties']['code'], city_feat['properties']['name']
            all_cities.append(city_feat)

            counties = [clean_feature(f, '县级码', '县级', 'boundary') for f in county_gj['features']]
            write_geojson(OUT / 'boundary' / 'county' / f'{city_code}.geojson', counties)

            # 县多边形(用于乡归属空间校验: 县级是2023数据, 乡级是2020数据,
            # 区划调整(下城/江干/临平/钱塘/龙港)导致部分乡 code 前缀对不上现行县)
            county_geoms = []
            for f in county_gj['features']:
                g = shape(f['geometry'])
                county_geoms.append((str(f['properties']['县级码']).strip(), prep(g)))
            county_set = {c for c, _ in county_geoms}

            n_reassign = 0
            by_county = {}
            county_tree = {}
            for f in town_gj['features']:
                tf = clean_feature(f, 'code', 'name', 'boundary')
                tcode = tf['properties']['code']
                target = tcode[:6] if tcode[:6] in county_set else None
                cent = shape(f['geometry']).centroid
                hit = next((c for c, pg in county_geoms if pg.contains(cent)), None)
                if hit and hit != target:
                    n_reassign += 1
                    target = hit
                if target is None:
                    target = tcode[:6]  # 兑底: 无包含关系时按原前缀
                by_county.setdefault(target, []).append(tf)
                county_tree.setdefault(target, []).append(
                    {'code': tcode, 'name': tf['properties']['name']})
            for c6, feats in by_county.items():
                write_geojson(OUT / 'boundary' / 'township' / f'{c6}.geojson', feats)

            manifest['cities'].append({
                'code': city_code, 'name': city_name,
                'counties': [
                    {'code': c['properties']['code'], 'name': c['properties']['name'],
                     'townships': sorted(county_tree.get(c['properties']['code'], []),
                                         key=lambda x: x['code'])}
                    for c in sorted(counties, key=lambda x: x['properties']['code'])
                ],
            })
            print(f'  {city_name}: {len(counties)} 县, '
                  f'{sum(len(v) for v in by_county.values())} 乡(空间重分配 {n_reassign})')

    write_geojson(OUT / 'boundary' / 'city' / '330000.geojson', all_cities)
    manifest['cities'].sort(key=lambda x: x['code'])
    return manifest


def process_villages():
    """村界 SHP -> villages/{乡镇码}.geojson; 返回 (乡镇数, 村总数)"""
    r = shapefile.Reader(str(SHP_PATH), encoding='gbk', encodingErrors='replace')
    fields = [f[0] for f in r.fields[1:]]
    i_tcode, i_tname = fields.index('乡镇码'), fields.index('乡镇级')
    i_vcode, i_vname = fields.index('村代码'), fields.index('村级')

    by_town = {}
    n = 0
    for sr in r.iterShapeRecords():
        rec = sr.record
        tcode = str(rec[i_tcode]).strip()
        if not tcode:
            continue
        geom = shape(sr.shape.__geo_interface__)
        geom = shp_simplify(geom, TOL_VILLAGE, preserve_topology=True)
        geom = normalize_polygonal_geometry(geom, str(rec[i_vcode]).strip())
        g = mapping(geom)
        by_town.setdefault(tcode, []).append({
            'type': 'Feature',
            'properties': {'code': str(rec[i_vcode]).strip(), 'name': str(rec[i_vname]).strip()},
            'geometry': g,
        })
        n += 1
        if n % 5000 == 0:
            print(f'  村界处理中... {n}')

    for tcode, feats in by_town.items():
        # 同一行政村可能由多个要素组成；按 code 溶解为单一可信边界，避免索引歧义。
        merged = []
        by_code = {}
        for feat in feats:
            code = feat['properties']['code']
            entry = by_code.setdefault(code, {'name': feat['properties']['name'], 'geometries': []})
            if entry['name'] != feat['properties']['name']:
                raise ValueError(f'源数据存在同一村代码对应不同名称，无法建立可信唯一节点: '
                                 f'{code} ({entry["name"]} / {feat["properties"]["name"]})')
            entry['geometries'].append(shape(feat['geometry']))
        for code, entry in sorted(by_code.items()):
            geom = normalize_polygonal_geometry(unary_union(entry['geometries']), code)
            merged.append({
                'type': 'Feature',
                'properties': {'code': code, 'name': entry['name']},
                'geometry': mapping(geom),
            })
        write_geojson(OUT / 'villages' / f'{tcode}.geojson', merged)
    return len(by_town), n


def main():
    # 只清理本脚本产物, 不碰 rs.json / tiles (脚本间幂等)
    boundary_only = '--boundary-only' in sys.argv
    shutil.rmtree(OUT / 'boundary', ignore_errors=True)
    (OUT / 'manifest.json').unlink(missing_ok=True)
    (OUT / 'weather' / 'index-v1.json').unlink(missing_ok=True)
    if not boundary_only:
        shutil.rmtree(OUT / 'villages', ignore_errors=True)
    print('[1/2] 四级边界拆分...')
    manifest = process_zip_boundaries()
    if boundary_only:
        print('[2/2] --boundary-only: 跳过村界重建')
    else:
        print('[2/2] 村界拆分(440MB SHP, 约2-5分钟)...')
        ntown, nvil = process_villages()
        print(f'村界: {ntown} 乡镇 / {nvil} 村')
    (OUT / 'manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
    weather_index = write_weather_spatial_index(OUT)
    print(f'天气空间索引: {weather_index}')
    print(f'完成: {len(manifest["cities"])} 市')
    print(f'产物目录: {OUT}')


if __name__ == '__main__':
    main()

# -*- coding: utf-8 -*-
"""
边界预处理:
  1. 解压 11 个地市 zip -> 按层级拆分 GeoJSON（剥离冗余 geom WKB 属性）
  2. 村界 SHP -> 按乡镇码拆分 villages/{乡镇码}.geojson（简化 ~1m 精度）
  3. 生成 manifest.json（五级层级树，仅 code+name）
  4. 将边界复制到服务端私有运行目录并生成 weather/index-v2.json（父链内代表点）
前端产物: web/public/data/
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
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely import make_valid, simplify as shp_simplify

from weather_spatial_index import DEFAULT_PRIVATE_DATA_DIR, write_weather_spatial_index
from village_corrections import load_verified_village_corrections
from township_corrections import load_township_corrections_for_zip

ROOT = Path(__file__).resolve().parent.parent
ZIP_DIR = ROOT / '01-行政区划' / '浙江四级边界加村点'
SHP_PATH = ROOT / '01-行政区划' / '浙江村界数据' / '3浙江村界-备注省市县乡' / '浙江村界.shp'
VILLAGE_CORRECTIONS_PATH = ROOT / 'scripts' / 'data' / 'weather-village-corrections-v1.json'
TOWNSHIP_CORRECTIONS_PATH = ROOT / 'scripts' / 'data' / 'weather-township-corrections-v1.json'
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


def pyshp_shape_to_geometry(shp):
    """从 pyshp 的 points/parts 构建 Shapely 面几何，跳过退化环。

    pyshp 的 Shape.__geo_interface__ 会对退化环做严格采样并抛错；本函数改为
    按面积/包含关系分类外环与洞，退化环交由 make_valid 收敛，避免整体失败。
    """
    def as_polygonal(g):
        if g.is_empty:
            return None
        if not g.is_valid:
            g = make_valid(g)
        if isinstance(g, GeometryCollection):
            gs = [x for x in g.geoms if x.geom_type in ('Polygon', 'MultiPolygon')]
            if not gs:
                return None
            g = unary_union(gs)
        if g.geom_type not in ('Polygon', 'MultiPolygon'):
            return None
        return g

    points = shp.points
    parts = list(shp.parts) if shp.parts else [0]
    n = len(points)
    rings = []
    for i, s in enumerate(parts):
        e = parts[i + 1] if i + 1 < len(parts) else n
        coords = [tuple(pt[:2]) for pt in points[s:e]]
        cleaned = []
        for c in coords:
            if not cleaned or cleaned[-1] != c:
                cleaned.append(c)
        if cleaned and cleaned[0] != cleaned[-1]:
            cleaned.append(cleaned[0])
        if len(cleaned) >= 4:
            rings.append(cleaned)
    if not rings:
        return Polygon()

    polys = []
    for r in rings:
        try:
            p = Polygon(r)
        except Exception:
            continue
        p = as_polygonal(p)
        if p is not None and p.area > 0:
            polys.append(p)
    if not polys:
        return Polygon()

    polys.sort(key=lambda p: p.area, reverse=True)
    outers = []
    holes = []
    for p in polys:
        if any(o is not p and o.covers(p) for o in outers):
            holes.append(p)
        else:
            outers.append(p)

    built = []
    for o in outers:
        o_holes = []
        for h in holes:
            if o.covers(h) and h.area < o.area:
                hs = h.geoms if isinstance(h, MultiPolygon) else [h]
                for sub in hs:
                    o_holes.append(list(sub.exterior.coords))
        try:
            built.append(as_polygonal(Polygon(o.exterior.coords, o_holes)))
        except Exception:
            built.append(o)

    built = [g for g in built if g is not None and not g.is_empty]
    if not built:
        return Polygon()
    return built[0] if len(built) == 1 else unary_union(built)


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
            town_raw = z.read(town_file)
            town_gj = json.loads(town_raw.decode('utf-8'))
            corrections = load_township_corrections_for_zip(
                ROOT, zp, town_file, town_raw, TOWNSHIP_CORRECTIONS_PATH)
            if corrections is not None:
                corrected_features = []
                for feature_index, feature in enumerate(town_gj['features']):
                    corrected = corrections.apply(feature_index, feature)
                    if corrected is not None:
                        corrected_features.append(corrected)
                corrections.verify_complete()
                town_gj['features'] = corrected_features

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


def is_village_level_code(code):
    """村级记录必须是 12 位且末三位非 000；000 表示乡级/类似乡级单位本身。"""
    return len(code) == 12 and code.isdigit() and code[-3:] != '000'


def process_villages():
    """村界 SHP -> villages/{乡镇码}.geojson; 返回 (乡镇数, 村总数)。"""
    source_path, identity_path, corrections = load_verified_village_corrections(
        ROOT, VILLAGE_CORRECTIONS_PATH)
    if source_path != SHP_PATH.resolve():
        raise ValueError(f'修正规则源路径与配置的 SHP_PATH 不一致: {source_path}')
    r = shapefile.Reader(str(source_path), encoding='gbk', encodingErrors='replace')
    identity_reader = shapefile.Reader(str(identity_path), encoding='utf-8', encodingErrors='strict')
    fields = [f[0] for f in r.fields[1:]]
    identity_fields = [f[0] for f in identity_reader.fields[1:]]
    i_tcode, i_tname = fields.index('乡镇码'), fields.index('乡镇级')
    i_vcode, i_vname = fields.index('村代码'), fields.index('村级')
    i_object_id = identity_fields.index('objectid')
    if len(r) != len(identity_reader):
        raise ValueError('村界源数据与 objectid identity 数据记录数不一致')

    by_town = {}
    n = 0
    excluded_non_village = 0
    for record_index, (sr, identity_record) in enumerate(zip(
            r.iterShapeRecords(), identity_reader.iterRecords(), strict=True)):
        rec = sr.record
        corrected = corrections.apply(record_index, str(identity_record[i_object_id]), {
            'townshipCode': str(rec[i_tcode]).strip(),
            'townshipName': str(rec[i_tname]).strip(),
            'villageCode': str(rec[i_vcode]).strip(),
            'villageName': str(rec[i_vname]).strip(),
        })
        if corrected is None:
            continue
        tcode = corrected['townshipCode']
        if not tcode:
            continue
        if not is_village_level_code(corrected['villageCode']):
            excluded_non_village += 1
            continue
        geom = pyshp_shape_to_geometry(sr.shape)
        geom = shp_simplify(geom, TOL_VILLAGE, preserve_topology=True)
        geom = normalize_polygonal_geometry(geom, corrected['villageCode'])
        g = mapping(geom)
        by_town.setdefault(tcode, []).append({
            'type': 'Feature',
            'properties': {
                'code': corrected['villageCode'],
                'name': corrected['villageName'],
            },
            'geometry': g,
        })
        n += 1
        if n % 5000 == 0:
            print(f'  村界处理中... {n}')
    corrections.verify_complete()
    print(f'  排除非村级面记录: {excluded_non_village}')

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
    shutil.rmtree(OUT / 'weather', ignore_errors=True)  # v1 曾公开生成；天气授权索引现只写服务端私有目录
    (OUT / 'manifest.json').unlink(missing_ok=True)
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
    weather_index = write_weather_spatial_index(OUT, DEFAULT_PRIVATE_DATA_DIR)
    print(f'天气私有空间索引: {weather_index}')
    print(f'完成: {len(manifest["cities"])} 市')
    print(f'产物目录: {OUT}')


if __name__ == '__main__':
    main()

# -*- coding: utf-8 -*-
"""
数据链路完整性校验: 模拟前端五级下钻, 验证每一级文件存在且为合法 GeoJSON
- 省界 / 11市 / 每市的县文件 / 每县的乡文件 / 每乡的村文件
- 要素数与 manifest 层级树一致
- 高分影像(rs.json)与村界的相交村清单
退出码: 0=全部通过, 1=有失败项
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'web' / 'public' / 'data'

passed, failed = [], []


def check(name, cond, detail=''):
    (passed if cond else failed).append(name)
    print(f"  {'✅' if cond else '❌'} {name} {detail}")


def load(p):
    try:
        return json.loads((DATA / p).read_text(encoding='utf-8'))
    except Exception as e:
        return e


def main():
    print('[1] 基础文件')
    manifest = load('manifest.json')
    check('manifest.json 可解析', isinstance(manifest, dict))
    rs = load('rs.json')
    check('rs.json 可解析', isinstance(rs, dict) and 'bounds' in rs)

    prov = load('boundary/province.geojson')
    check('省界 1 要素', isinstance(prov, dict) and len(prov.get('features', [])) == 1)
    cities = load('boundary/city/330000.geojson')
    check('市级 11 要素', isinstance(cities, dict) and len(cities.get('features', [])) == 11)

    print('[2] 全链路: 市->县->乡->村 文件存在性与要素数')
    n_county_file = n_town_file = n_vil_file = 0
    missing_vil, bad = [], []
    for city in manifest['cities']:
        fc = load(f"boundary/county/{city['code']}.geojson")
        if not isinstance(fc, dict) or len(fc['features']) != len(city['counties']):
            bad.append(f"county/{city['code']}")
            continue
        n_county_file += 1
        for county in city['counties']:
            ft = load(f"boundary/township/{county['code']}.geojson")
            if not isinstance(ft, dict) or len(ft['features']) != len(county['townships']):
                bad.append(f"township/{county['code']}")
                continue
            n_town_file += 1
            for town in county['townships']:
                fv = load(f"villages/{town['code']}.geojson")
                if isinstance(fv, dict):
                    n_vil_file += 1
                else:
                    missing_vil.append((town['name'], town['code']))
    check('县级文件 11 个全部存在且要素数匹配', n_county_file == 11 and not [b for b in bad if b.startswith('county')],
          f'{n_county_file}/11')
    check('乡级文件全部存在且要素数匹配', not [b for b in bad if b.startswith('township')],
          f'{n_town_file} 个')
    # 11 个中心城区街道在村界源中完全缺失；另有 27 个乡镇只出现末三位 000 的
    # 乡镇本级/围垦面，没有有效村级要素。预处理会排除这些非村记录，不生成空文件。
    expect_missing = 38
    check(f'村界文件缺失数 = {expect_missing}(无有效村级面)', len(missing_vil) == expect_missing,
          f'缺失 {len(missing_vil)}: {[m[0] for m in missing_vil]}')
    total_towns = sum(len(c['townships']) for city in manifest['cities'] for c in city['counties'])
    check(f'村界文件 = 乡总数({total_towns}) - {expect_missing}', n_vil_file == total_towns - expect_missing,
          f'{n_vil_file}')

    print('[3] 演示路径')
    for code, name, sub in [('330600', '绍兴', 'boundary/county'),
                            ('330604', '上虞', 'boundary/township'),
                            ('330604102000', '上浦镇', 'villages'),
                            ('330604104000', '章镇镇', 'villages')]:
        p = DATA / sub / f'{code}.geojson'
        check(f'{name}({code}) 文件存在', p.exists())

    print('[4] 高分影像覆盖村')
    w, s, e, n = rs['bounds']

    def bb(g, box):
        def walk(c):
            if isinstance(c[0], (int, float)):
                box[0] = min(box[0], c[0]); box[1] = min(box[1], c[1])
                box[2] = max(box[2], c[0]); box[3] = max(box[3], c[1])
            else:
                for x in c:
                    walk(x)
        walk(g['coordinates'])
        return box

    hit = 0
    for t in ('330604104000', '330683104000'):
        fc = load(f'villages/{t}.geojson')
        for feat in fc['features']:
            b = bb(feat['geometry'], [999, 999, -999, -999])
            if b[0] < e and b[2] > w and b[1] < n and b[3] > s:
                hit += 1
    check('影像覆盖村 = 17(章镇11+三界6)', hit == 17, f'实测 {hit}')

    print(f'\n结果: {len(passed)} 通过, {len(failed)} 失败')
    if failed:
        print('失败项:', failed)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())

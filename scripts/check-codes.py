# -*- coding: utf-8 -*-
"""
编码一致性校验：锐多宝乡级边界 code vs 村界 SHP 乡镇码
- 数据源1: 01-行政区划/浙江四级边界加村点/*.zip 内 乡镇/乡镇边界_*.geojson
- 数据源2: 01-行政区划/浙江村界数据/3浙江村界-备注省市县乡/浙江村界.dbf
校验项:
  1. 乡级名称是否互相覆盖
  2. 同名乡镇的 12 位编码是否一致
  3. 演示路径关键节点(上虞区/上浦镇)是否存在
"""
import json
import struct
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ZIP_DIR = ROOT / '01-行政区划' / '浙江四级边界加村点'
DBF = ROOT / '01-行政区划' / '浙江村界数据' / '3浙江村界-备注省市县乡' / '浙江村界.dbf'


def load_rdb_townships():
    """锐多宝: {code: (name, city)} + 名称索引"""
    by_code, by_name = {}, defaultdict(list)
    for zp in sorted(ZIP_DIR.glob('33*-GeoJSON.zip')):
        with zipfile.ZipFile(zp) as z:
            town_file = [n for n in z.namelist() if n.startswith('乡镇/')][0]
            gj = json.loads(z.read(town_file).decode('utf-8'))
            city = zp.name.split('-')[1]
            for f in gj['features']:
                p = f['properties']
                name, code = str(p.get('name', '')).strip(), str(p.get('code', '')).strip()
                by_code[code] = (name, city)
                by_name[name].append((code, city))
    return by_code, by_name


def load_shp_townships():
    """村界SHP: {乡镇码: (乡镇名, 区县名, 村数量)}"""
    info = {}
    with open(DBF, 'rb') as f:
        h = f.read(32)
        nrec, hlen, rlen = struct.unpack('<IHH', h[4:12][:8])
        fields = []
        while True:
            d = f.read(32)
            if d[0] == 0x0D:
                break
            fields.append((d[0:11].split(b'\x00')[0].decode('gbk', 'ignore'), d[16]))
        idx = {n: i for i, (n, _) in enumerate(fields)}
        f.seek(hlen)
        # 预先计算各字段偏移
        offs, pos = [], 1
        for n, flen in fields:
            offs.append((n, pos, flen))
            pos += flen
        for _ in range(nrec):
            rec = f.read(rlen)
            if not rec or len(rec) < rlen:
                break
            vals = {n: rec[o:o + l].decode('gbk', 'ignore').strip() for n, o, l in offs}
            tcode = vals.get('乡镇码', '')
            if not tcode:
                continue
            if tcode not in info:
                info[tcode] = [vals.get('乡镇级', ''), vals.get('区县级', ''), 0]
            info[tcode][2] += 1
    return info


def main():
    rdb_code, rdb_name = load_rdb_townships()
    shp = load_shp_townships()
    shp_by_name = defaultdict(list)
    for code, (name, county, cnt) in shp.items():
        shp_by_name[name].append((code, county))

    print(f'锐多宝乡镇数: {len(rdb_code)}  村界SHP乡镇数: {len(shp)}')
    print(f'村界SHP村总数: {sum(v[2] for v in shp.values())}')

    # 1) 名称+编码完全一致
    exact = sum(1 for c in rdb_code if c in shp)
    print(f'\n[1] 编码直接匹配(12位code相同): {exact}/{len(rdb_code)}')

    # 2) 名称匹配但编码不同
    mismatch, name_only = [], 0
    for code, (name, city) in rdb_code.items():
        if code in shp:
            continue
        if name in shp_by_name:
            name_only += 1
            if len(mismatch) < 10:
                mismatch.append((city, name, code, shp_by_name[name]))
    print(f'[2] 名称匹配但编码不同: {name_only}')
    for m in mismatch:
        print('    样例:', m)

    # 3) 名称也不在SHP中
    missing = [(city, name) for code, (name, city) in rdb_code.items()
               if code not in shp and name not in shp_by_name]
    print(f'[3] 锐多宝有、SHP完全没有: {len(missing)}')
    for m in missing[:10]:
        print('    样例:', m)

    # 4) SHP有、锐多宝没有
    extra = [(v[0], v[1], c) for c, v in shp.items() if c not in rdb_code]
    print(f'[4] SHP有、锐多宝乡镇边界没有: {len(extra)}')
    for m in extra[:10]:
        print('    样例:', m)

    # 5) 演示路径
    print('\n[5] 演示路径检查:')
    sp = [(c, v) for c, v in shp.items() if v[0] == '上浦镇']
    rp = [(c, n) for c, (n, city) in rdb_code.items() if n == '上浦镇']
    print('    SHP 上浦镇:', sp)
    print('    锐多宝 上浦镇:', rp)
    sy = [(c, v) for c, v in shp.items() if v[1] == '上虞区']
    print(f'    SHP 上虞区乡镇数: {len(sy)}, 村数: {sum(v[2] for _, v in sy)}')


if __name__ == '__main__':
    sys.exit(main())

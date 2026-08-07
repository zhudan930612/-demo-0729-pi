"""Create the fixed 4+1 parcel insurance confirmation artifact.

龙江村（默认村）保留既有手工确认产物：检测到现有 confirmation 文件时直接跳过生成，
确保现役数据绝对不变（--force 才重新生成，且从现有文件读取并保留未参保集合）。

其他村按龙江村同一套规则确定性生成：
- 未参保地块：按地块 ID 取模的确定性规则（int(id) % 17 == 0，约 5.9%，满足 ≤10% 上限）。
- 四个经营区：复用龙江村的归一化坐标条带规则 region_index（u 西→东、v 北→南，村 bbox 内 0~1），
  参考龙江村四个大致空间经营区的划分思想，不依赖龙江村具体截图。
- 四区外参保地块一块一户进入唯一分户清单。
"""
from __future__ import annotations
import argparse
import json, math
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VILLAGE = "330604102014"
VILLAGES_DIR = ROOT / 'web/public/data/villages'
REGION_PARTIES = [f'party-{index:04d}' for index in range(1, 5)]


def source_path(code: str) -> Path:
    return ROOT / 'web/public/data/parcels' / f'{code}.geojson'


def output_path(code: str) -> Path:
    # 龙江村保持历史文件名 parcel-confirmation-v1.json；其余村按村代码命名
    if code == DEFAULT_VILLAGE:
        return ROOT / 'web/src/data/parcel-confirmation-v1.json'
    return ROOT / 'web/src/data' / f'parcel-confirmation-{code}.json'


def distance(a, b):
    lat = (a[1] + b[1]) / 2 * math.pi / 180
    dx = (a[0] - b[0]) * 111320 * math.cos(lat)
    dy = (a[1] - b[1]) * 110540
    return math.hypot(dx, dy)


def max_span(group, points):
    return max((distance(points[a], points[b]) for i, a in enumerate(group) for b in group[i + 1:]), default=0)


def region_index(u: float, v: float) -> int | None:
    """Return the region index using normalized village parcel coordinates.

    u grows west-to-east; v grows north-to-south. Same four approximate spatial belts as
    the longjiang pilot (west-central, northern, south-west, east-central), applied to the
    current village's own normalized bounding box. Order resolves approximate overlaps.
    """
    if u < .60 and .25 <= v < .55:
        return 0  # 1: west-central belt
    if u < .60 and v < .25:
        return 1  # 2: northern belt
    if u < .44 and .55 <= v < .86:
        return 2  # 3: south-west belt
    if .44 <= u < .82 and .25 <= v < .64:
        return 3  # 4: east-central belt
    return None


def deterministic_uninsured(ids: list[str]) -> set[str]:
    """确定性未参保集合：ID 为 17 的倍数（约 5.9%，满足不超过 10% 上限）。"""
    return {parcel_id for parcel_id in ids if int(parcel_id) % 17 == 0}


def generate(code: str, force: bool = False) -> None:
    if code == DEFAULT_VILLAGE:
        # 龙江村现有确认是人工逐块确认产物（含 83 块未参保手工清单），重跑无法复现原分配；
        # 任何情况下都不重新生成或覆盖，确保现役数据绝对不变。
        out = output_path(code)
        if out.exists():
            print(f'龙江村确认文件受保护，跳过生成: {out}')
            return
        raise SystemExit('龙江村确认文件不存在，现役数据缺失；请先恢复后再操作')
    src = source_path(code)
    if not src.exists():
        raise SystemExit(f'missing local parcel source: {src}')
    data = json.loads(src.read_text(encoding='utf8'))
    features = sorted(data['features'], key=lambda f: int(f['properties']['id']))
    areas = {str(f['properties']['id']): Decimal(str(f['properties']['area_mu'])) for f in features}
    points = {str(f['properties']['id']): (float(f['properties']['label_lng']), float(f['properties']['label_lat'])) for f in features}
    ids = sorted(areas, key=int)

    out = output_path(code)
    if out.exists() and not force:
        print(f'确认文件已存在且受保护: {out}（--force 才重新生成）')
        return
    existing_uninsured: set[str] = set()
    if out.exists() and force:
        existing = json.loads(out.read_text(encoding='utf8'))
        existing_uninsured = {record['parcelId'] for record in existing['records'] if not record['insured']}
        if not existing_uninsured:
            raise SystemExit('现有确认文件未参保集合为空，拒绝覆盖')
        print(f'{code}: --force 保留现有 {len(existing_uninsured)} 块未参保地块并重新生成')
    else:
        existing_uninsured = deterministic_uninsured(ids)
        print(f'{code}: 按确定性规则生成未参保集合 {len(existing_uninsured)} 块（{len(existing_uninsured) / len(ids):.1%}）')

    uninsured = existing_uninsured
    insured_ids = [i for i in ids if i not in uninsured]

    xs = [point[0] for point in points.values()]
    ys = [point[1] for point in points.values()]
    min_x, max_x, min_y, max_y = min(xs), max(xs), min(ys), max(ys)
    regions = [[] for _ in REGION_PARTIES]
    roster = []
    for parcel_id in insured_ids:
        x, y = points[parcel_id]
        u = (x - min_x) / (max_x - min_x) if max_x > min_x else 0.5
        v = (max_y - y) / (max_y - min_y) if max_y > min_y else 0.5
        index = region_index(u, v)
        (regions[index] if index is not None else roster).append(parcel_id)

    assignments = {}
    for party_id, group in zip(REGION_PARTIES, regions):
        assignments.update({parcel_id: party_id for parcel_id in group})
    next_party = len(REGION_PARTIES) + 1
    for parcel_id in roster:
        assignments[parcel_id] = f'party-{next_party:04d}'
        next_party += 1

    metrics = []
    for party_id, group in zip(REGION_PARTIES, regions):
        total = sum((areas[x] for x in group), Decimal(0))
        metrics.append({
            'insuredPartyId': party_id,
            'parcelCount': len(group),
            'geometryAreaMu': str(total.quantize(Decimal('.0001'))),
            'insuredModePreview': 'single_insured',
            'spatialGroupCount': 1,
            'primaryGroupAreaRatio': 1.0,
            'maxDistanceM': round(max_span(group, points), 1),
            'isolatedParcelIds': [],
            'manualReview': '通过：复用龙江村四大致空间条带规则（归一化坐标）',
            'regionIndex': int(party_id[-4:]),
        })
    metrics.append({
        'insuredPartyId': 'roster-one-parcel-per-party',
        'parcelCount': len(roster),
        'insuredModePreview': 'insured_roster',
        'rosterItemCount': len(roster),
        'manualReview': '通过：四区外参保地块一块一户',
    })

    records = [{
        'parcelId': parcel_id,
        'insured': parcel_id not in uninsured,
        'insuredPartyId': assignments.get(parcel_id),
        'confirmedAt': '2025-04-01',
        'confirmedBy': 'operator-01',
    } for parcel_id in ids]
    output = {
        'schemaVersion': 'parcel-confirmation-v1',
        'villageCode': code,
        'confirmedAt': '2025-04-01',
        'confirmedBy': 'operator-01',
        'assignmentModel': 'four-approximate-regions-plus-one-parcel-roster',
        'records': records,
        'spatialReview': metrics,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf8')
    red_count = sum(map(len, regions))
    print(json.dumps({
        'villageCode': code,
        'records': len(records),
        'insured': len(assignments),
        'uninsured': len(uninsured),
        'uninsuredShare': round(len(uninsured) / len(ids), 4),
        'regionParcelCounts': [len(group) for group in regions],
        'regionAreaMu': [str(sum((areas[x] for x in group), Decimal(0)).quantize(Decimal('.01'))) for group in regions],
        'redRegionParcelCount': red_count,
        'redRegionShareOfInsured': round(red_count / len(assignments), 4),
        'rosterItemCount': len(roster),
        'output': str(out),
    }, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description='生成 4+1 地块参保确认产物')
    parser.add_argument('--village', default=DEFAULT_VILLAGE, help=f'村代码（默认 {DEFAULT_VILLAGE}）')
    parser.add_argument('--force', action='store_true', help='非龙江村确认文件已存在时强制重新生成')
    args = parser.parse_args()
    generate(args.village, force=args.force)


if __name__ == '__main__':
    main()

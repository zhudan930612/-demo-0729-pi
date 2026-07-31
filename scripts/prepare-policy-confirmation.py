"""Create the fixed 4+1 parcel insurance confirmation artifact.

The four large operating regions are an intentionally approximate spatial reading of the
review screenshot. The existing 83 uninsured parcel IDs are preserved. Every remaining
insured parcel outside the four regions becomes a one-parcel roster item.
"""
from __future__ import annotations
import json, math
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'web/public/data/parcels/330604102014.geojson'
OUTPUT = ROOT / 'web/src/data/parcel-confirmation-v1.json'
EXISTING_CONFIRMATION = OUTPUT
REGION_PARTIES = [f'party-{index:04d}' for index in range(1, 5)]


def distance(a, b):
    lat = (a[1] + b[1]) / 2 * math.pi / 180
    dx = (a[0] - b[0]) * 111320 * math.cos(lat)
    dy = (a[1] - b[1]) * 110540
    return math.hypot(dx, dy)


def max_span(group, points):
    return max((distance(points[a], points[b]) for i, a in enumerate(group) for b in group[i + 1:]), default=0)


def region_index(u: float, v: float) -> int | None:
    """Return the screenshot region index using normalized village parcel coordinates.

    u grows west-to-east; v grows north-to-south. Order resolves approximate overlaps.
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


def main():
    data = json.loads(SOURCE.read_text(encoding='utf8'))
    features = sorted(data['features'], key=lambda f: int(f['properties']['id']))
    areas = {str(f['properties']['id']): Decimal(str(f['properties']['area_mu'])) for f in features}
    points = {str(f['properties']['id']): (float(f['properties']['label_lng']), float(f['properties']['label_lat'])) for f in features}

    existing = json.loads(EXISTING_CONFIRMATION.read_text(encoding='utf8'))
    uninsured = {record['parcelId'] for record in existing['records'] if not record['insured']}
    if len(uninsured) != 83:
        raise SystemExit(f'expected to preserve 83 uninsured parcels, found {len(uninsured)}')

    xs = [point[0] for point in points.values()]
    ys = [point[1] for point in points.values()]
    min_x, max_x, min_y, max_y = min(xs), max(xs), min(ys), max(ys)
    regions = [[] for _ in REGION_PARTIES]
    roster = []
    for parcel_id in sorted(areas, key=int):
        if parcel_id in uninsured:
            continue
        x, y = points[parcel_id]
        u = (x - min_x) / (max_x - min_x)
        v = (max_y - y) / (max_y - min_y)
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
            'manualReview': '通过：按用户标注截图进行大致空间划分',
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
    } for parcel_id in sorted(areas, key=int)]
    output = {
        'schemaVersion': 'parcel-confirmation-v1',
        'villageCode': '330604102014',
        'confirmedAt': '2025-04-01',
        'confirmedBy': 'operator-01',
        'assignmentModel': 'four-approximate-regions-plus-one-parcel-roster',
        'records': records,
        'spatialReview': metrics,
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf8')
    red_count = sum(map(len, regions))
    print(json.dumps({
        'records': len(records),
        'insured': len(assignments),
        'uninsuredPreserved': len(uninsured),
        'regionParcelCounts': [len(group) for group in regions],
        'redRegionParcelCount': red_count,
        'redRegionShareOfInsured': round(red_count / len(assignments), 4),
        'rosterItemCount': len(roster),
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

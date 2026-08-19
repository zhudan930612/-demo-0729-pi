"""Create the chained spatial clustering parcel insurance confirmation artifact.

地块成片划分 V1（替换 4+1 模型，需求《地块成片划分-V1需求.md》）：

- 参保地块按质心距离 ≤200m 建邻接图，连通分量 = 链式成片组（组内任意地块到同组最近邻 ≤200m 自动满足）。
- 分类面积（内部 4 位小数求和、四舍五入 2 位）>500 亩的连通分量按贪心 BFS 切分为多个 ≤500 亩相邻子组；
  切分后若某块在子组内失去 200m 内邻居（孤岛），该块退出大户，按团单一块一户处理。
- 每组分类面积 >50.00 亩立大户（单一型保单，一个 party）；≤50.00 亩组内逐块各立独立 party（一块一户进团单）。
- 单块参保地块 >50.00 亩（孤立无邻居）同样立大户（trivially 成片）；恰好 50.00 亩不立大户。
- 未参保地块不参与聚类、不归属任何保单。

龙江村（默认村）与全部参保村使用同一套规则；龙江村重新生成时从现有确认文件读取并保留
未参保集合（现 83 块），未参保集合为空时拒绝覆盖；其他村确认文件已存在且非 --force 时
受保护跳过，--force 时同样保留现有未参保集合，无现有文件时用确定性规则 int(id) % 17 == 0。

确定性：遍历一律 sorted，固定输入两次运行产物一致；单村秒级。
"""
from __future__ import annotations
import argparse
import json
import math
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VILLAGE = "330604102014"
ADJACENCY_DISTANCE_M = 200.0
MAX_GROUP_AREA_MU = Decimal("500.00")
BIG_FARM_MIN_AREA_MU = Decimal("50.00")
ASSIGNMENT_MODEL = "spatial-chained-clustering-500mu-cap"


def source_path(code: str) -> Path:
    return ROOT / 'web/public/data/parcels' / f'{code}.geojson'


def output_path(code: str) -> Path:
    # 龙江村保持历史文件名 parcel-confirmation-v1.json；其余村按村代码命名
    if code == DEFAULT_VILLAGE:
        return ROOT / 'web/src/data/parcel-confirmation-v1.json'
    return ROOT / 'web/src/data' / f'parcel-confirmation-{code}.json'


def distance(a, b) -> float:
    """两质心的平面近似距离（米）。"""
    lat = (a[1] + b[1]) / 2 * math.pi / 180
    dx = (a[0] - b[0]) * 111320 * math.cos(lat)
    dy = (a[1] - b[1]) * 110540
    return math.hypot(dx, dy)


def max_span(group, points) -> float:
    """组内最远两地块质心距离（米）；单块为 0。"""
    return max((distance(points[a], points[b]) for i, a in enumerate(group) for b in group[i + 1:]), default=0)


def classified_area(group, areas) -> Decimal:
    """分类面积：组内 4 位小数求和后四舍五入到 2 位亩数。"""
    return sum((areas[pid] for pid in group), Decimal(0)).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)


def deterministic_uninsured(ids: list[str]) -> set[str]:
    """确定性未参保集合：ID 为 17 的倍数（约 5.9%，满足不超过 10% 上限）。"""
    return {parcel_id for parcel_id in ids if int(parcel_id) % 17 == 0}


def build_adjacency(parcel_ids: list[str], points: dict) -> dict[str, set[str]]:
    """参保地块按质心距离 ≤200m 建无向邻接图（O(n²)，单村秒级）。"""
    adj = {pid: set() for pid in parcel_ids}
    for i in range(len(parcel_ids)):
        a = parcel_ids[i]
        for b in parcel_ids[i + 1:]:
            if distance(points[a], points[b]) <= ADJACENCY_DISTANCE_M:
                adj[a].add(b)
                adj[b].add(a)
    return adj


def connected_components(parcel_ids: list[str], adj: dict) -> list[list[str]]:
    """连通分量 = 链式成片组；结果按最小地块 id 排序，保证确定性。"""
    remaining = set(parcel_ids)
    components = []
    while remaining:
        seed = min(remaining)
        component = []
        stack = [seed]
        while stack:
            cur = stack.pop()
            if cur not in remaining:
                continue
            remaining.discard(cur)
            component.append(cur)
            stack.extend(adj[cur])
        components.append(sorted(component, key=int))
    return sorted(components, key=lambda c: int(c[0]))


def split_large_component(component: list[str], adj: dict, areas: dict) -> list[list[str]]:
    """将分类面积 >500 亩的连通分量切分为多个 ≤500 亩的相邻子组。

    贪心 BFS：从确定性种子（最小地块 id）出发逐层扩展，仅把"加入后分类面积仍 ≤500 亩"
    的地块并入当前组；放不下的地块留在剩余集合，按连通子分量继续切分。
    切分保证每个非种子地块在加入时都与组内某地块有 ≤200m 边（链式连通）。
    """
    if classified_area(component, areas) <= MAX_GROUP_AREA_MU:
        return [component]
    remaining = set(component)
    groups = []
    while remaining:
        seed = min(remaining)
        group = []
        frontier = [seed]
        while frontier:
            nxt = []
            for cur in frontier:
                if cur not in remaining:
                    continue
                if classified_area(group + [cur], areas) <= MAX_GROUP_AREA_MU:
                    group.append(cur)
                    remaining.discard(cur)
                    nxt.extend(adj[cur])
            frontier = sorted(nxt, key=int)
        groups.append(sorted(group, key=int))
    return groups


def enforce_in_group_neighbors(group: list[str], adj: dict) -> tuple[list[str], list[str]]:
    """保证子组内每块仍有组内 200m 内邻居；剔除组内孤岛地块（按团单一块一户处理）。

    单块组直接保留（trivially 成片）。返回 (保留组, 剔除的孤岛地块列表)。
    """
    kept = sorted(group, key=int)
    demoted = []
    while True:
        isolated = [pid for pid in kept if len(kept) > 1 and not any(nb in kept for nb in adj[pid])]
        if not isolated:
            break
        pid = isolated[0]
        kept.remove(pid)
        demoted.append(pid)
    return kept, demoted


def generate(code: str, force: bool = False) -> None:
    src = source_path(code)
    if not src.exists():
        raise SystemExit(f'missing local parcel source: {src}')
    data = json.loads(src.read_text(encoding='utf8'))
    features = sorted(data['features'], key=lambda f: int(f['properties']['id']))
    areas = {str(f['properties']['id']): Decimal(str(f['properties']['area_mu'])).quantize(Decimal('.0001'))
             for f in features}
    points = {str(f['properties']['id']): (float(f['properties']['label_lng']), float(f['properties']['label_lat']))
              for f in features}
    ids = sorted(areas, key=int)

    out = output_path(code)
    if out.exists() and not force:
        print(f'确认文件已存在且受保护: {out}（--force 才重新生成，重新生成保留现有未参保集合）')
        return
    existing_uninsured: set[str] = set()
    if out.exists():
        existing = json.loads(out.read_text(encoding='utf8'))
        existing_uninsured = {record['parcelId'] for record in existing['records'] if not record['insured']}
        if not existing_uninsured:
            raise SystemExit('现有确认文件未参保集合为空，拒绝覆盖')
        print(f'{code}: 重新生成并保留现有未参保集合 {len(existing_uninsured)} 块')
    else:
        existing_uninsured = deterministic_uninsured(ids)
        print(f'{code}: 按确定性规则生成未参保集合 {len(existing_uninsured)} 块（{len(existing_uninsured) / len(ids):.1%}）')

    uninsured = {pid for pid in existing_uninsured if pid in areas}
    insured_ids = [i for i in ids if i not in uninsured]

    adj = build_adjacency(insured_ids, points)
    components = connected_components(insured_ids, adj)
    groups: list[list[str]] = []
    for component in components:
        if classified_area(component, areas) <= MAX_GROUP_AREA_MU:
            sub_groups = [component]
        else:
            sub_groups = split_large_component(component, adj, areas)
        for sub in sub_groups:
            kept, demoted = enforce_in_group_neighbors(sub, adj)
            if kept:
                groups.append(kept)
            for pid in demoted:
                groups.append([pid])

    big_farm_groups: list[list[str]] = []
    roster_parcels: list[str] = []
    for group in groups:
        if classified_area(group, areas) > BIG_FARM_MIN_AREA_MU:
            big_farm_groups.append(group)
        else:
            roster_parcels.extend(group)
    big_farm_groups.sort(key=lambda g: min(int(pid) for pid in g))
    roster_parcels.sort(key=int)

    assignments: dict[str, str] = {}
    party_number = 1
    for group in big_farm_groups:
        party_id = f'party-{party_number:04d}'
        for pid in group:
            assignments[pid] = party_id
        party_number += 1
    for pid in roster_parcels:
        assignments[pid] = f'party-{party_number:04d}'
        party_number += 1

    metrics: list[dict] = []
    for group in big_farm_groups:
        party_id = assignments[group[0]]
        total = sum((areas[pid] for pid in group), Decimal(0))
        metrics.append({
            'insuredPartyId': party_id,
            'parcelCount': len(group),
            'geometryAreaMu': str(total.quantize(Decimal('.0001'))),
            'classifiedAreaMu': str(total.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)),
            'insuredModePreview': 'single_insured',
            'spatialGroupCount': 1,
            'primaryGroupAreaRatio': 1.0,
            'maxDistanceM': round(max_span(group, points), 1),
            'isolatedParcelIds': [],
            'manualReview': '通过：成片聚类（质心距离≤200m 链式连通，无孤岛）；分类面积>50.00 且≤500.00 亩',
        })
    metrics.append({
        'insuredPartyId': 'roster-one-parcel-per-party',
        'parcelCount': len(roster_parcels),
        'insuredModePreview': 'insured_roster',
        'rosterItemCount': len(roster_parcels),
        'manualReview': '通过：参保地块一块一户进团单（≤50.00 亩或切分孤岛回收地块）',
    })
    insured_area = sum((areas[pid] for pid in insured_ids), Decimal(0))
    big_area = sum((sum((areas[pid] for pid in group), Decimal(0)) for group in big_farm_groups), Decimal(0))
    share = round(float(big_area / insured_area), 4) if insured_area else 0
    metrics.append({
        'insuredPartyId': 'coverage-summary',
        'bigFarmCount': len(big_farm_groups),
        'bigFarmParcelCount': sum(len(g) for g in big_farm_groups),
        'bigFarmInsuredAreaMu': str(big_area.quantize(Decimal('.0001'))),
        'insuredAreaMu': str(insured_area.quantize(Decimal('.0001'))),
        'bigFarmCoverageShareOfInsuredArea': share,
        'manualReview': '大户合计覆盖参保面积实际比例（无硬性指标，聚类自然形态，验收 1.4）',
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
        'assignmentModel': ASSIGNMENT_MODEL,
        'records': records,
        'spatialReview': metrics,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({
        'villageCode': code,
        'records': len(records),
        'insured': len(assignments),
        'uninsured': len(uninsured),
        'uninsuredShare': round(len(uninsured) / len(ids), 4),
        'bigFarmCount': len(big_farm_groups),
        'bigFarmParcelCount': sum(len(g) for g in big_farm_groups),
        'bigFarmAreaMu': str(big_area.quantize(Decimal('.01'))),
        'bigFarmCoverageShareOfInsuredArea': share,
        'rosterItemCount': len(roster_parcels),
        'output': str(out),
    }, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description='生成成片聚类地块参保确认产物（地块成片划分 V1）')
    parser.add_argument('--village', default=DEFAULT_VILLAGE, help=f'村代码（默认 {DEFAULT_VILLAGE}）')
    parser.add_argument('--force', action='store_true', help='确认文件已存在时强制重新生成（保留现有未参保集合）')
    args = parser.parse_args()
    generate(args.village, force=args.force)


if __name__ == '__main__':
    main()

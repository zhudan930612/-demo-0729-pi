# -*- coding: utf-8 -*-
"""prepare-policy-confirmation.py 参数化单测：成片聚类（≤200m）、500 亩切分、50 亩分类、
单块 >50 亩立大户、确定性、龙江村标注区域模式/其他村重生成保留未参保集合。
断言落在 generate() 输出的 confirmation 结构（records/spatialReview）上，不测内部聚类函数细节。
"""

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
SCRIPT = SCRIPTS / "prepare-policy-confirmation.py"
SPEC = importlib.util.spec_from_file_location("prepare_policy_confirmation", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

LONGJIANG = "330604102014"
DAQIAN = "330604102015"
XINWEI = "330604102017"
OTHER = "330604102018"
GRID = 0.001  # 网格间距：相邻质心约 96~110m（≤200m），全连通


def make_parcel_source(count: int = 200, area_mu: float = 2.0, spacing: float = GRID) -> Path:
    """生成 count 个地块的 GeoJSON（spacing 网格铺开）。"""
    tmp = Path(tempfile.mkdtemp())
    src = tmp / f"{count}.geojson"
    features = []
    cols = int(count ** 0.5) + 1
    for i in range(1, count + 1):
        row = (i - 1) // cols
        col = (i - 1) % cols
        lon = 120.0 + col * spacing
        lat = 30.0 + row * spacing
        features.append({
            "type": "Feature",
            "properties": {"id": i, "area_m2": round(area_mu * 666.67, 2), "area_mu": area_mu,
                           "label_lng": lon, "label_lat": lat},
            "geometry": {"type": "Polygon", "coordinates": [[[lon, lat], [lon + spacing / 2, lat],
                                                             [lon + spacing / 2, lat + spacing / 2],
                                                             [lon, lat + spacing / 2], [lon, lat]]]},
        })
    src.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
    return src


def make_cluster_plus_scattered(cluster_ids: int, scattered_ids: int, cluster_area: float = 3.0,
                                scattered_area: float = 2.0) -> Path:
    """密集成片簇（0.001 网格，连通）+ 远处孤立地块（0.01 间距，互不相邻）。"""
    tmp = Path(tempfile.mkdtemp())
    src = tmp / "mixed.geojson"
    features = []
    cols = 10
    for i in range(1, cluster_ids + 1):
        row = (i - 1) // cols
        col = (i - 1) % cols
        lon = 120.0 + col * GRID
        lat = 30.0 + row * GRID
        features.append({"type": "Feature", "properties": {"id": i, "area_m2": round(cluster_area * 666.67, 2),
                                                           "area_mu": cluster_area, "label_lng": lon, "label_lat": lat},
                         "geometry": {"type": "Polygon", "coordinates": []}})
    for j in range(cluster_ids + 1, cluster_ids + scattered_ids + 1):
        lon = 120.05 + (j - cluster_ids) * 0.01
        lat = 30.05 + (j - cluster_ids) * 0.01
        features.append({"type": "Feature", "properties": {"id": j, "area_m2": round(scattered_area * 666.67, 2),
                                                           "area_mu": scattered_area, "label_lng": lon, "label_lat": lat},
                         "geometry": {"type": "Polygon", "coordinates": []}})
    src.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
    return src


def make_confirmation(parcel_ids: list[str], uninsured_ids: set[str], model: str = "four-approximate-regions-plus-one-parcel-roster") -> dict:
    """构造旧模型确认文件内容（用于 --force 保留未参保集合场景）。"""
    return {
        "schemaVersion": "parcel-confirmation-v1",
        "villageCode": LONGJIANG,
        "confirmedAt": "2025-04-01",
        "confirmedBy": "operator-01",
        "assignmentModel": model,
        "records": [{"parcelId": pid, "insured": pid not in uninsured_ids,
                     "insuredPartyId": None if pid in uninsured_ids else "party-0001",
                     "confirmedAt": "2025-04-01", "confirmedBy": "operator-01"}
                    for pid in sorted(parcel_ids, key=int)],
        "spatialReview": [],
    }


def make_regions_config(path: Path, regions: list, merge_meters: float = 0.0, code: str = LONGJIANG) -> Path:
    """写入标注区域配置（villageCode=code）。regions: [(party_id, [[lng,lat],...]), ...]。"""
    path.write_text(json.dumps({
        "villageCode": code,
        "assignmentModel": "user-annotated-regions-v1",
        "mergeMeters": merge_meters,
        "regions": [{"party": party, "polygon": polygon} for party, polygon in regions],
    }, ensure_ascii=False), encoding="utf-8")
    return path


def run_generate(code: str, src: Path, out: Path, force: bool = False, regions: list | None = None,
                 merge_meters: float = 0.0) -> dict:
    """regions 提供时写入临时标注区域配置并 patch regions_config_path；
    默认使用覆盖全部源地块的大区域（全部参保地块进 party-0001）。"""
    original_source_path = MODULE.source_path
    original_output_path = MODULE.output_path
    original_regions_path = MODULE.regions_config_path
    cfg = src.parent / "regions.json"
    if regions is None:
        regions = [("party-0001", [[119.0, 29.0], [121.0, 29.0], [121.0, 31.0], [119.0, 31.0]])]
    make_regions_config(cfg, regions, merge_meters, code=code)
    try:
        MODULE.source_path = lambda c: src
        MODULE.output_path = lambda c: out
        MODULE.regions_config_path = lambda c: cfg
        MODULE.generate(code, force=force)
    finally:
        MODULE.source_path = original_source_path
        MODULE.output_path = original_output_path
        MODULE.regions_config_path = original_regions_path
    return json.loads(out.read_text(encoding="utf-8"))


def read_points(src: Path) -> dict:
    data = json.loads(src.read_text(encoding="utf-8"))
    return {str(f["properties"]["id"]): (float(f["properties"]["label_lng"]), float(f["properties"]["label_lat"]))
            for f in data["features"]}


class PreparePolicyConfirmationTest(unittest.TestCase):
    def test_output_path_by_village(self):
        self.assertEqual(MODULE.output_path(LONGJIANG).name, "parcel-confirmation-v1.json")
        self.assertEqual(MODULE.output_path(OTHER).name, f"parcel-confirmation-{OTHER}.json")

    def test_deterministic_uninsured_share_within_10pct(self):
        for count in (200, 1533, 1000):
            ids = [str(i) for i in range(1, count + 1)]
            uninsured = MODULE.deterministic_uninsured(ids)
            self.assertLessEqual(len(uninsured) / count, 0.10)
            self.assertGreater(len(uninsured), 0)

    # ---- 龙江村：授权重生成，保留既有未参保集合 ----
    def test_longjiang_without_force_keeps_existing_file(self):
        src = make_parcel_source(200)
        out = src.parent / "parcel-confirmation-v1.json"
        un = {"7", "14", "21"}
        out.write_text(json.dumps(make_confirmation([str(i) for i in range(1, 201)], un), ensure_ascii=False), encoding="utf-8")
        before = out.read_text(encoding="utf-8")
        data = run_generate(LONGJIANG, src, out, force=False)
        self.assertEqual(before, out.read_text(encoding="utf-8"))

    def test_longjiang_force_regenerate_converts_all_to_insured(self):
        # 区域模式（plan-merge100）：未参保全部转参保（83→0），不再保留未参保集合
        src = make_parcel_source(200)
        out = src.parent / "parcel-confirmation-v1.json"
        un = {"7", "14", "21", "105"}
        out.write_text(json.dumps(make_confirmation([str(i) for i in range(1, 201)], un), ensure_ascii=False), encoding="utf-8")
        data = run_generate(LONGJIANG, src, out, force=True)
        new_un = {r["parcelId"] for r in data["records"] if not r["insured"]}
        self.assertEqual(new_un, set(), "区域模式未参保应全部转参保")
        self.assertTrue(all(r["insured"] for r in data["records"]))
        self.assertEqual(data["assignmentModel"], MODULE.LONGJIANG_ASSIGNMENT_MODEL)
        self.assertEqual(len(data["records"]), 200)

    def test_longjiang_force_allows_empty_uninsured(self):
        # 区域模式目标未参保=0：现有确认文件未参保为空时可正常重新生成
        src = make_parcel_source(200)
        out = src.parent / "parcel-confirmation-v1.json"
        out.write_text(json.dumps(make_confirmation([str(i) for i in range(1, 201)], set()), ensure_ascii=False), encoding="utf-8")
        data = run_generate(LONGJIANG, src, out, force=True)
        self.assertEqual({r["parcelId"] for r in data["records"] if not r["insured"]}, set())

    # ---- 其他村：--force 保留现有未参保集合；无文件时确定性规则 ----
    def test_other_village_force_preserves_existing_uninsured(self):
        src = make_parcel_source(150)
        out = src.parent / f"parcel-confirmation-{OTHER}.json"
        un = {"3", "9", "27"}
        out.write_text(json.dumps(make_confirmation([str(i) for i in range(1, 151)], un), ensure_ascii=False), encoding="utf-8")
        data = run_generate(OTHER, src, out, force=True)
        new_un = {r["parcelId"] for r in data["records"] if not r["insured"]}
        self.assertEqual(new_un, un)

    def test_other_village_fresh_uses_deterministic_rule(self):
        src = make_parcel_source(200)
        out = src.parent / f"parcel-confirmation-{OTHER}.json"
        data = run_generate(OTHER, src, out, force=False)
        expected = MODULE.deterministic_uninsured([str(i) for i in range(1, 201)])
        new_un = {r["parcelId"] for r in data["records"] if not r["insured"]}
        self.assertEqual(new_un, expected)

    # ---- 成片判定：任意地块到同户最近邻 ≤200m（验收 1.1/1.2/1.3）----
    def test_generate_chained_clusters_within_200m(self):
        src = make_cluster_plus_scattered(cluster_ids=100, scattered_ids=30)
        out = src.parent / "conf.json"
        data = run_generate(OTHER, src, out)
        points = read_points(src)
        metrics = [m for m in data["spatialReview"] if m["insuredPartyId"].startswith("party-")]
        self.assertGreaterEqual(len(metrics), 1)
        for metric in metrics:
            self.assertEqual(metric["isolatedParcelIds"], [], f"{metric['insuredPartyId']} 不应有孤岛")
            classified = Decimal(metric["classifiedAreaMu"])
            self.assertGreater(classified, Decimal("50.00"), "大户分类面积必须 >50.00 亩")
            self.assertLessEqual(classified, Decimal("500.00"), "大户分类面积必须 ≤500 亩")
        # 从 records 独立重算：每户任意地块到同户最近邻质心距离 ≤200m
        groups = {}
        for record in data["records"]:
            if record["insured"]:
                groups.setdefault(record["insuredPartyId"], []).append(record["parcelId"])
        for party, group in groups.items():
            if len(group) <= 1:
                continue
            for a in group:
                nearest = min(MODULE.distance(points[a], points[b]) for b in group if b != a)
                self.assertLessEqual(nearest, 200.0, f"{party} 地块 {a} 最近邻 {nearest:.1f}m 超过 200m")

    def test_generate_500mu_cap_splits_large_cluster(self):
        src = make_parcel_source(300, area_mu=3.0, spacing=GRID)
        out = src.parent / "conf.json"
        data = run_generate(OTHER, src, out)
        metrics = [m for m in data["spatialReview"] if m["insuredPartyId"].startswith("party-")]
        # 300 块 × 3 亩 ≈ 900 亩（去掉约 6% 未参保仍 >500 亩），必须切分为 ≥2 个相邻子组
        self.assertGreaterEqual(len(metrics), 2)
        for metric in metrics:
            self.assertLessEqual(Decimal(metric["classifiedAreaMu"]), Decimal("500.00"))
            self.assertGreater(Decimal(metric["classifiedAreaMu"]), Decimal("50.00"))

    def test_single_parcel_over_50_mu_is_big_farm(self):
        # 1 块 63 亩孤立大田 + 4 块 1 亩小地块成簇：63 亩单块立大户（trivially 成片）
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "single-big.geojson"
        features = [
            {"type": "Feature", "properties": {"id": 1, "area_m2": 42000, "area_mu": 63.0,
                                               "label_lng": 120.0, "label_lat": 30.0},
             "geometry": {"type": "Polygon", "coordinates": []}},
        ]
        for i in range(2, 6):
            features.append({"type": "Feature", "properties": {"id": i, "area_m2": 667, "area_mu": 1.0,
                                                               "label_lng": 120.1 + (i - 2) * 0.001,
                                                               "label_lat": 30.1},
                             "geometry": {"type": "Polygon", "coordinates": []}})
        src.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
        out = src.parent / "conf.json"
        data = run_generate(OTHER, src, out)
        metrics = [m for m in data["spatialReview"] if m["insuredPartyId"].startswith("party-")]
        self.assertEqual(len(metrics), 1)
        self.assertEqual(metrics[0]["parcelCount"], 1)
        self.assertEqual(Decimal(metrics[0]["classifiedAreaMu"]), Decimal("63.00"))
        self.assertEqual(metrics[0]["maxDistanceM"], 0.0)
        roster = [m for m in data["spatialReview"] if m["insuredPartyId"] == "roster-one-parcel-per-party"][0]
        self.assertEqual(roster["parcelCount"], 4)

    def test_exactly_50_mu_not_big_farm(self):
        # 2 块相邻 25 亩合计恰好 50.00 亩：不立大户，全部一块一户进团单
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "exact-50.geojson"
        features = []
        for i, area in ((1, 25.0), (2, 25.0)):
            features.append({"type": "Feature", "properties": {"id": i, "area_m2": round(area * 666.67, 2),
                                                               "area_mu": area,
                                                               "label_lng": 120.0 + (i - 1) * GRID,
                                                               "label_lat": 30.0},
                             "geometry": {"type": "Polygon", "coordinates": []}})
        src.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
        out = src.parent / "conf.json"
        data = run_generate(OTHER, src, out)
        big = [m for m in data["spatialReview"] if m["insuredPartyId"].startswith("party-")]
        self.assertEqual(len(big), 0)
        roster = [m for m in data["spatialReview"] if m["insuredPartyId"] == "roster-one-parcel-per-party"][0]
        self.assertEqual(roster["parcelCount"], 2)
        self.assertEqual(len(data["records"]), 2)
        summary = [m for m in data["spatialReview"] if m["insuredPartyId"] == "coverage-summary"][0]
        self.assertEqual(summary["bigFarmCount"], 0)
        self.assertEqual(summary["bigFarmCoverageShareOfInsuredArea"], 0)

    # ---- 覆盖比例报告（验收 1.4）：summary 与实际一致 ----
    def test_coverage_summary_matches_records(self):
        src = make_cluster_plus_scattered(cluster_ids=100, scattered_ids=30)
        out = src.parent / "conf.json"
        data = run_generate(OTHER, src, out)
        summary = [m for m in data["spatialReview"] if m["insuredPartyId"] == "coverage-summary"][0]
        areas = {str(f["properties"]["id"]): Decimal(str(f["properties"]["area_mu"])).quantize(Decimal(".0001"))
                 for f in json.loads(src.read_text(encoding="utf-8"))["features"]}
        insured_area = sum((areas[r["parcelId"]] for r in data["records"] if r["insured"]), Decimal(0))
        big_area = Decimal(summary["bigFarmInsuredAreaMu"])
        self.assertEqual(summary["insuredAreaMu"], str(insured_area.quantize(Decimal(".0001"))))
        self.assertAlmostEqual(summary["bigFarmCoverageShareOfInsuredArea"],
                               float(big_area / insured_area), places=4)
        self.assertGreater(summary["bigFarmCoverageShareOfInsuredArea"], 0.0)

    # ---- 确定性（验收 3.1）：固定输入两次运行产物一致 ----
    def test_deterministic_two_runs_identical_hash(self):
        src = make_cluster_plus_scattered(cluster_ids=100, scattered_ids=30)
        out = src.parent / "conf.json"
        run_generate(OTHER, src, out)
        first = out.read_bytes()
        out.unlink()
        run_generate(OTHER, src, out)
        second = out.read_bytes()
        self.assertEqual(hashlib.sha256(first).hexdigest(), hashlib.sha256(second).hexdigest())

    def test_deterministic_force_preserve_two_runs_identical_hash(self):
        src = make_parcel_source(150)
        out = src.parent / f"parcel-confirmation-{OTHER}.json"
        un = {"3", "9", "27"}
        out.write_text(json.dumps(make_confirmation([str(i) for i in range(1, 151)], un), ensure_ascii=False), encoding="utf-8")
        run_generate(OTHER, src, out, force=True)
        first = out.read_bytes()
        run_generate(OTHER, src, out, force=True)
        second = out.read_bytes()
        self.assertEqual(hashlib.sha256(first).hexdigest(), hashlib.sha256(second).hexdigest())

    # ---- 龙江村：标注区域模式（user-annotated-regions-v1，plan-merge100）----
    def test_longjiang_region_mode_assigns_by_polygon(self):
        # 两个方形区域 + 区域外孤立地块：区域内归大户、区域外一块一户；未参保全部转参保（83→0）
        regions = [
            ("party-0001", [[120.000, 30.000], [120.010, 30.000], [120.010, 30.010], [120.000, 30.010]]),
            ("party-0002", [[120.020, 30.000], [120.030, 30.000], [120.030, 30.010], [120.020, 30.010]]),
        ]
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "region-parcels.geojson"
        parcels = []  # (id, lng, lat)
        for i in range(1, 4):      # 区域1 内 3 块（0.001 网格）
            parcels.append((i, 120.005 + (i - 1) * GRID, 30.005))
        for i in range(4, 6):      # 区域2 内 2 块
            parcels.append((i, 120.025 + (i - 4) * GRID, 30.005))
        for i in range(6, 9):      # 区域外 3 块（互不相邻、远离区域）
            parcels.append((i, 120.050 + (i - 6) * 0.01, 30.050))
        features = [{"type": "Feature", "properties": {"id": pid, "area_m2": 2000.0, "area_mu": 3.0,
                                                         "label_lng": lng, "label_lat": lat},
                     "geometry": {"type": "Polygon", "coordinates": []}} for pid, lng, lat in parcels]
        src.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
        out = src.parent / "parcel-confirmation-v1.json"
        un = {"7"}  # 旧未参保（7）应转参保
        out.write_text(json.dumps(make_confirmation([str(i) for i in range(1, 9)], un), ensure_ascii=False), encoding="utf-8")
        data = run_generate(LONGJIANG, src, out, force=True, regions=regions)
        self.assertEqual(data["assignmentModel"], MODULE.LONGJIANG_ASSIGNMENT_MODEL)
        recs = {r["parcelId"]: r for r in data["records"]}
        self.assertEqual(recs["1"]["insuredPartyId"], "party-0001")
        self.assertEqual(recs["2"]["insuredPartyId"], "party-0001")
        self.assertEqual(recs["3"]["insuredPartyId"], "party-0001")
        self.assertEqual(recs["4"]["insuredPartyId"], "party-0002")
        self.assertEqual(recs["5"]["insuredPartyId"], "party-0002")
        # 区域外（含原未参保 7）：独立 party，且不与大户共用
        self.assertNotIn(recs["6"]["insuredPartyId"], ("party-0001", "party-0002"))
        self.assertNotEqual(recs["6"]["insuredPartyId"], recs["8"]["insuredPartyId"])
        # 区域内未参保转参保；区域外未参保保留（一般区域规则）
        self.assertFalse(recs["7"]["insured"])
        self.assertIsNone(recs["7"]["insuredPartyId"])
        self.assertTrue(all(r["insured"] for pid, r in recs.items() if pid != "7"))
        # spatialReview：2 个区域大户 + roster + summary
        region_metrics = [m for m in data["spatialReview"] if m["insuredPartyId"].startswith("party-")]
        self.assertEqual([m["insuredPartyId"] for m in region_metrics], ["party-0001", "party-0002"])
        self.assertEqual(region_metrics[0]["parcelCount"], 3)
        self.assertEqual(region_metrics[1]["parcelCount"], 2)
        self.assertTrue(all(m["isolatedParcelIds"] == [] for m in region_metrics))
        self.assertEqual(region_metrics[0]["regionIndex"], 1)
        roster = [m for m in data["spatialReview"] if m["insuredPartyId"] == "roster-one-parcel-per-party"][0]
        self.assertEqual(roster["parcelCount"], 2)  # 6、8
        summary = [m for m in data["spatialReview"] if m["insuredPartyId"] == "coverage-summary"][0]
        self.assertEqual(summary["bigFarmCount"], 2)
        self.assertGreater(summary["bigFarmCoverageShareOfInsuredArea"], 0.0)

    def test_longjiang_region_mode_merge_100m(self):
        # 区域外块到最近区域内地块质心距离 <100m → 归并进最近区域大户
        regions = [("party-0001", [[120.000, 30.000], [120.010, 30.000], [120.010, 30.010], [120.000, 30.010]])]
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "region-merge.geojson"
        parcels = [
            (1, 120.0005, 30.0005),   # 区域内
            (2, 120.0099, 30.0099),   # 区域内（右缘内）
            (3, 120.0105, 30.0099),   # 区域外但距 2 约 58m <100m → 归并
            (4, 120.0500, 30.0500),   # 区域外且远离 → 团单
        ]
        features = [{"type": "Feature", "properties": {"id": pid, "area_m2": 2000.0, "area_mu": 3.0,
                                                         "label_lng": lng, "label_lat": lat},
                     "geometry": {"type": "Polygon", "coordinates": []}} for pid, lng, lat in parcels]
        src.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
        out = src.parent / "parcel-confirmation-v1.json"
        data = run_generate(LONGJIANG, src, out, force=False, regions=regions, merge_meters=100.0)
        recs = {r["parcelId"]: r for r in data["records"]}
        self.assertEqual(recs["1"]["insuredPartyId"], "party-0001")
        self.assertEqual(recs["2"]["insuredPartyId"], "party-0001")
        self.assertEqual(recs["3"]["insuredPartyId"], "party-0001", "100m 内应归并进区域大户")
        self.assertNotEqual(recs["4"]["insuredPartyId"], "party-0001", "远离区域应进团单")
        metric = [m for m in data["spatialReview"] if m["insuredPartyId"] == "party-0001"][0]
        self.assertEqual(metric["parcelCount"], 3)
        roster = [m for m in data["spatialReview"] if m["insuredPartyId"] == "roster-one-parcel-per-party"][0]
        self.assertEqual(roster["parcelCount"], 1)

    def test_longjiang_region_mode_regions_chained(self):
        # 区域内地块组内最近邻 ≤200m、无孤岛；区域外一块一户
        regions = [("party-0001", [[120.000, 30.000], [120.010, 30.000], [120.010, 30.010], [120.000, 30.010]])]
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "region-chain.geojson"
        features = []
        for i in range(1, 5):
            features.append({"type": "Feature", "properties": {"id": i, "area_m2": 2000.0, "area_mu": 3.0,
                                                                 "label_lng": 120.000 + (i - 1) * GRID,
                                                                 "label_lat": 30.000 + (i - 1) * GRID},
                             "geometry": {"type": "Polygon", "coordinates": []}})
        src.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
        out = src.parent / "parcel-confirmation-v1.json"
        data = run_generate(LONGJIANG, src, out, force=False, regions=regions)
        metric = [m for m in data["spatialReview"] if m["insuredPartyId"] == "party-0001"][0]
        self.assertEqual(metric["parcelCount"], 4)
        self.assertEqual(metric["isolatedParcelIds"], [])
        points = read_points(src)
        group = [r["parcelId"] for r in data["records"] if r["insuredPartyId"] == "party-0001"]
        for a in group:
            nearest = min(MODULE.distance(points[a], points[b]) for b in group if b != a)
            self.assertLessEqual(nearest, 200.0, f"地块 {a} 最近邻 {nearest:.1f}m 超过 200m")

    def test_longjiang_region_mode_roster_one_parcel_per_party(self):
        # 区域内/区域外混合：区域外参保地块严格一块一户进团单（不与大户共用 party）
        regions = [("party-0001", [[120.000, 30.000], [120.005, 30.000], [120.005, 30.005], [120.000, 30.005]])]
        src = make_parcel_source(60)
        out = src.parent / "parcel-confirmation-v1.json"
        data = run_generate(LONGJIANG, src, out, force=False, regions=regions)
        party_parcels = {}
        for r in data["records"]:
            if r["insured"]:
                party_parcels.setdefault(r["insuredPartyId"], []).append(r["parcelId"])
        big_farm_ids = {m["insuredPartyId"] for m in data["spatialReview"] if m["insuredPartyId"].startswith("party-")}
        roster_parties = {p for p, v in party_parcels.items() if p not in big_farm_ids}
        self.assertTrue(roster_parties, "区域外参保地块应进团单")
        self.assertTrue(all(len(party_parcels[p]) == 1 for p in roster_parties), "团单必须一块一户")
        self.assertIn("party-0001", big_farm_ids, "区域内地块应立大户")

    def test_longjiang_region_mode_outside_pool_all_roster(self):
        # 区域模式以区域划分为权威归属：区域外团单池全部一块一户进团单（忽略 50 亩单独出单规则）
        regions = [("party-0001", [[120.000, 30.000], [120.010, 30.000], [120.010, 30.010], [120.000, 30.010]])]
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "parcels.geojson"
        features = []
        for i in range(1, 21):  # 区域内 20 块 × 3 亩 = 60 亩（未参保已转参保，id 17 也在区域内）
            row = (i - 1) // 5
            col = (i - 1) % 5
            features.append({"type": "Feature", "properties": {"id": i, "area_m2": 2000, "area_mu": 3.0,
                                                                 "label_lng": 120.000 + col * 0.001,
                                                                 "label_lat": 30.000 + row * 0.001},
                             "geometry": {"type": "Polygon", "coordinates": []}})
        features.append({"type": "Feature", "properties": {"id": 21, "area_m2": 34267, "area_mu": 51.4,
                                                               "label_lng": 120.100, "label_lat": 30.100},
                         "geometry": {"type": "Polygon", "coordinates": []}})
        for i in range(22, 31):
            features.append({"type": "Feature", "properties": {"id": i, "area_m2": 667, "area_mu": 1.0,
                                                                 "label_lng": 120.110 + (i - 22) * 0.01,
                                                                 "label_lat": 30.110 + (i - 22) * 0.01},
                             "geometry": {"type": "Polygon", "coordinates": []}})
        src.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
        out = src.parent / "parcel-confirmation-v1.json"
        data = run_generate(LONGJIANG, src, out, force=False, regions=regions)
        metrics = {m["insuredPartyId"]: m for m in data["spatialReview"] if m["insuredPartyId"].startswith("party-")}
        self.assertEqual(list(metrics), ["party-0001"], "区域外团单池（含 >50 亩块）不出单一型指标")
        self.assertEqual(metrics["party-0001"]["parcelCount"], 20)
        self.assertEqual(metrics["party-0001"]["regionIndex"], 1)
        roster = [m for m in data["spatialReview"] if m["insuredPartyId"] == "roster-one-parcel-per-party"][0]
        self.assertEqual(roster["parcelCount"], 10)
        summary = [m for m in data["spatialReview"] if m["insuredPartyId"] == "coverage-summary"][0]
        self.assertEqual(summary["bigFarmCount"], 1)
        self.assertGreater(summary["bigFarmCoverageShareOfInsuredArea"], 0.0)
        recs = {r["parcelId"]: r for r in data["records"]}
        self.assertEqual(recs["21"]["insuredPartyId"], "party-0002")
        self.assertEqual(recs["22"]["insuredPartyId"], "party-0003")

    def test_longjiang_region_mode_maxlng_right_boundary(self):
        # 区域级 maxLng 右边界约定：区域内/归并块中 lng > maxLng 的移出到团单池（一块一户）
        regions = [("party-0001", [[120.000, 30.000], [120.010, 30.000], [120.010, 30.010], [120.000, 30.010]],
                   120.005)]  # (party, polygon, maxLng)
        # 手动构造带 maxLng 的配置：party-0001 多边形 [120.000-120.010]，maxLng=120.005
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "parcels.geojson"
        features = []
        for i in range(1, 9):  # 8 块：lng 120.000-120.007（一半 <120.005，一半 ≥120.005）
            features.append({"type": "Feature", "properties": {"id": i, "area_m2": 2000, "area_mu": 3.0,
                                                                 "label_lng": 120.000 + (i - 1) * 0.001,
                                                                 "label_lat": 30.005},
                             "geometry": {"type": "Polygon", "coordinates": []}})
        src.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
        out = src.parent / "parcel-confirmation-v1.json"
        cfg_path = src.parent / "regions.json"
        cfg_path.write_text(json.dumps({
            "villageCode": LONGJIANG,
            "assignmentModel": "user-annotated-regions-v1",
            "mergeMeters": 0.0,
            "regions": [{"party": "party-0001",
                         "polygon": [[120.000, 30.000], [120.010, 30.000], [120.010, 30.010], [120.000, 30.010]],
                         "maxLng": 120.005}],
        }, ensure_ascii=False), encoding="utf-8")
        orig = (MODULE.source_path, MODULE.output_path, MODULE.regions_config_path)
        MODULE.source_path = lambda c: src
        MODULE.output_path = lambda c: out
        MODULE.regions_config_path = lambda c: cfg_path
        try:
            MODULE.generate(LONGJIANG, force=False)
        finally:
            MODULE.source_path, MODULE.output_path, MODULE.regions_config_path = orig
        data = json.loads(out.read_text(encoding="utf-8"))
        recs = {r["parcelId"]: r for r in data["records"]}
        # lng ≤ 120.005 的 6 块（120.000-120.005）留大户；lng > 120.005 的 2 块（120.006/120.007）移出团单
        self.assertTrue(all(recs[str(i)]["insuredPartyId"] == "party-0001" for i in range(1, 7)))
        self.assertTrue(all(recs[str(i)]["insuredPartyId"] != "party-0001" for i in range(7, 9)))
        metric = [m for m in data["spatialReview"] if m["insuredPartyId"] == "party-0001"][0]
        self.assertEqual(metric["parcelCount"], 6)
        roster = [m for m in data["spatialReview"] if m["insuredPartyId"] == "roster-one-parcel-per-party"][0]
        self.assertEqual(roster["parcelCount"], 2)

    def test_daqian_region_mode_bbox_assign_and_uninsured_kept(self):
        # 大钱村（330604102015）区域模式 v3：严格按红框 bbox、无 100m 归并；
        # 区域内全部（含未参保）归大户；区域外未参保保留、区域外参保一块一户团单
        regions = [
            ("party-0001", [[120.000, 30.000], [120.010, 30.000], [120.010, 30.010], [120.000, 30.010]]),
            ("party-0002", [[120.020, 30.000], [120.030, 30.000], [120.030, 30.010], [120.020, 30.010]]),
        ]
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "daqian-parcels.geojson"
        parcels = [
            (1, 120.005, 30.005), (2, 120.006, 30.005),   # 框1 内
            (3, 120.025, 30.005), (4, 120.026, 30.005),   # 框2 内
            (5, 120.0105, 30.005),  # 框1 外紧邻（mergeMeters=0 不归并 → 团单）
            (6, 120.050, 30.050),
            (7, 120.060, 30.060),
        ]
        features = [{"type": "Feature", "properties": {"id": pid, "area_m2": 2000.0, "area_mu": 3.0,
                                                         "label_lng": lng, "label_lat": lat},
                     "geometry": {"type": "Polygon", "coordinates": []}} for pid, lng, lat in parcels]
        src.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
        out = src.parent / "conf.json"
        un = {"2", "7"}  # 2 在框1 内（转参保）、7 在框外（保留未参保）
        out.write_text(json.dumps(make_confirmation([str(i) for i in range(1, 8)], un), ensure_ascii=False), encoding="utf-8")
        data = run_generate(DAQIAN, src, out, force=True, regions=regions, merge_meters=0.0)
        self.assertEqual(data["assignmentModel"], MODULE.LONGJIANG_ASSIGNMENT_MODEL)
        recs = {r["parcelId"]: r for r in data["records"]}
        self.assertEqual(recs["1"]["insuredPartyId"], "party-0001")
        self.assertEqual(recs["2"]["insuredPartyId"], "party-0001", "区域内未参保应转参保归大户")
        self.assertEqual(recs["3"]["insuredPartyId"], "party-0002")
        self.assertEqual(recs["4"]["insuredPartyId"], "party-0002")
        self.assertNotEqual(recs["5"]["insuredPartyId"], "party-0001", "mergeMeters=0 时紧邻红框也不归并")
        self.assertNotEqual(recs["6"]["insuredPartyId"], "party-0001")
        # 区域外未参保保留
        self.assertFalse(recs["7"]["insured"])
        self.assertIsNone(recs["7"]["insuredPartyId"])
        new_un = {r["parcelId"] for r in data["records"] if not r["insured"]}
        self.assertEqual(new_un, {"7"})
        # spatialReview
        region_metrics = [m for m in data["spatialReview"] if m["insuredPartyId"].startswith("party-")]
        self.assertEqual([m["insuredPartyId"] for m in region_metrics], ["party-0001", "party-0002"])
        self.assertTrue(all(m["isolatedParcelIds"] == [] for m in region_metrics))
        roster = [m for m in data["spatialReview"] if m["insuredPartyId"] == "roster-one-parcel-per-party"][0]
        self.assertEqual(roster["parcelCount"], 2)  # 5、6
        summary = [m for m in data["spatialReview"] if m["insuredPartyId"] == "coverage-summary"][0]
        self.assertEqual(summary["bigFarmCount"], 2)

    def test_xinweijiazhuang_region_mode_polygon_assign(self):
        # 新魏家庄村（330604102017）区域模式：1 个红框多边形、无归并；
        # 区域内全部（含未参保）归大户、区域外未参保保留、区域外参保一块一户团单
        regions = [("party-0001", [[120.000, 30.000], [120.010, 30.000], [120.010, 30.010], [120.000, 30.010]])]
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "xinwei-parcels.geojson"
        parcels = [
            (1, 120.005, 30.005), (2, 120.006, 30.005),   # 框内
            (3, 120.0105, 30.005),  # 框外紧邻（mergeMeters=0 不归并）
            (4, 120.050, 30.050),
            (5, 120.060, 30.060),
        ]
        features = [{"type": "Feature", "properties": {"id": pid, "area_m2": 2000.0, "area_mu": 3.0,
                                                         "label_lng": lng, "label_lat": lat},
                     "geometry": {"type": "Polygon", "coordinates": []}} for pid, lng, lat in parcels]
        src.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
        out = src.parent / "conf.json"
        un = {"2", "5"}  # 2 框内（转参保）、5 框外（保留）
        out.write_text(json.dumps(make_confirmation([str(i) for i in range(1, 6)], un), ensure_ascii=False), encoding="utf-8")
        data = run_generate(XINWEI, src, out, force=True, regions=regions, merge_meters=0.0)
        self.assertEqual(data["assignmentModel"], MODULE.LONGJIANG_ASSIGNMENT_MODEL)
        recs = {r["parcelId"]: r for r in data["records"]}
        self.assertEqual(recs["1"]["insuredPartyId"], "party-0001")
        self.assertEqual(recs["2"]["insuredPartyId"], "party-0001", "区域内未参保应转参保归大户")
        self.assertNotEqual(recs["3"]["insuredPartyId"], "party-0001", "mergeMeters=0 时不归并")
        self.assertNotEqual(recs["4"]["insuredPartyId"], "party-0001")
        self.assertFalse(recs["5"]["insured"])
        self.assertIsNone(recs["5"]["insuredPartyId"])
        self.assertEqual({r["parcelId"] for r in data["records"] if not r["insured"]}, {"5"})
        metric = [m for m in data["spatialReview"] if m["insuredPartyId"] == "party-0001"][0]
        self.assertEqual(metric["parcelCount"], 2)
        self.assertEqual(metric["isolatedParcelIds"], [])
        roster = [m for m in data["spatialReview"] if m["insuredPartyId"] == "roster-one-parcel-per-party"][0]
        self.assertEqual(roster["parcelCount"], 2)  # 3、4

    def test_qingtan_region_mode_empty_regions_all_roster(self):
        # 清潭村（330604102016）区域模式：regions 为空 = 无大户区域，全部参保地块一块一户进唯一团单；未参保保留
        tmp = Path(tempfile.mkdtemp())
        src = make_parcel_source(60)
        out = src.parent / "conf.json"
        data = run_generate("330604102016", src, out, force=False, regions=[], merge_meters=0.0)
        self.assertEqual(data["assignmentModel"], MODULE.LONGJIANG_ASSIGNMENT_MODEL)
        big = [m for m in data["spatialReview"] if m["insuredPartyId"].startswith("party-")]
        self.assertEqual(len(big), 0, "无大户区域不应有单一型指标")
        roster = [m for m in data["spatialReview"] if m["insuredPartyId"] == "roster-one-parcel-per-party"][0]
        insured = [r for r in data["records"] if r["insured"]]
        self.assertEqual(roster["parcelCount"], len(insured))
        self.assertTrue(all(len([r for r in data["records"] if r["insuredPartyId"] == r2["insuredPartyId"]]) == 1
                            for r2 in insured), "全部参保地块一块一户")
        self.assertEqual(roster["rosterItemCount"], len(insured))
        # 未参保保留（确定性规则 int(id)%17==0）
        new_un = {r["parcelId"] for r in data["records"] if not r["insured"]}
        self.assertEqual(new_un, MODULE.deterministic_uninsured([str(i) for i in range(1, 61)]))
        summary = [m for m in data["spatialReview"] if m["insuredPartyId"] == "coverage-summary"][0]
        self.assertEqual(summary["bigFarmCount"], 0)
        self.assertEqual(summary["bigFarmCoverageShareOfInsuredArea"], 0)

    def test_longjiang_region_mode_deterministic(self):
        regions = [("party-0001", [[120.000, 30.000], [120.010, 30.000], [120.010, 30.010], [120.000, 30.010]])]
        src = make_parcel_source(120)
        out = src.parent / "parcel-confirmation-v1.json"
        run_generate(LONGJIANG, src, out, force=False, regions=regions)
        first = out.read_bytes()
        out.unlink()
        run_generate(LONGJIANG, src, out, force=False, regions=regions)
        second = out.read_bytes()
        self.assertEqual(hashlib.sha256(first).hexdigest(), hashlib.sha256(second).hexdigest())

    # ---- 归属完整性（验收 1.6）：未参保不归属；参保恰好归属一个大户或团单 ----
    def test_assignment_completeness(self):
        src = make_parcel_source(200)
        out = src.parent / f"parcel-confirmation-{OTHER}.json"
        data = run_generate(OTHER, src, out)
        for record in data["records"]:
            if record["insured"]:
                self.assertIsNotNone(record["insuredPartyId"])
                self.assertNotIn(record["insuredPartyId"], ("roster-one-parcel-per-party", "coverage-summary"))
            else:
                self.assertIsNone(record["insuredPartyId"])
        party_parcels = {}
        for record in data["records"]:
            if record["insured"]:
                party_parcels.setdefault(record["insuredPartyId"], []).append(record["parcelId"])
        big_farm_ids = {m["insuredPartyId"] for m in data["spatialReview"] if m["insuredPartyId"].startswith("party-")}
        for party, parcels in party_parcels.items():
            if len(parcels) > 1:
                # 多块 party 必须是大户（单一型）片区，且片区内无重复归属
                self.assertIn(party, big_farm_ids, f"多块 party {party} 应是大户片区")
            else:
                # 一块一户进团单的地块 party 互不共用
                self.assertNotIn(party, big_farm_ids, f"团单一块一户地块 {parcels[0]} 不应与大户共用 party")


if __name__ == "__main__":
    unittest.main()

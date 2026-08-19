# -*- coding: utf-8 -*-
"""prepare-policy-confirmation.py 参数化单测：成片聚类（≤200m）、500 亩切分、50 亩分类、
单块 >50 亩立大户、确定性、龙江村/其他村重生成保留未参保集合。
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
OTHER = "330604102016"
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


def run_generate(code: str, src: Path, out: Path, force: bool = False) -> dict:
    original_source_path = MODULE.source_path
    original_output_path = MODULE.output_path
    try:
        MODULE.source_path = lambda c: src
        MODULE.output_path = lambda c: out
        MODULE.generate(code, force=force)
    finally:
        MODULE.source_path = original_source_path
        MODULE.output_path = original_output_path
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

    def test_longjiang_force_regenerate_preserves_uninsured(self):
        src = make_parcel_source(200)
        out = src.parent / "parcel-confirmation-v1.json"
        un = {"7", "14", "21", "105"}
        out.write_text(json.dumps(make_confirmation([str(i) for i in range(1, 201)], un), ensure_ascii=False), encoding="utf-8")
        data = run_generate(LONGJIANG, src, out, force=True)
        new_un = {r["parcelId"] for r in data["records"] if not r["insured"]}
        self.assertEqual(new_un, un)
        self.assertEqual(data["assignmentModel"], MODULE.ASSIGNMENT_MODEL)
        self.assertEqual(len(data["records"]), 200)

    def test_longjiang_force_refuses_empty_uninsured(self):
        src = make_parcel_source(200)
        out = src.parent / "parcel-confirmation-v1.json"
        out.write_text(json.dumps(make_confirmation([str(i) for i in range(1, 201)], set()), ensure_ascii=False), encoding="utf-8")
        with self.assertRaises(SystemExit):
            run_generate(LONGJIANG, src, out, force=True)

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

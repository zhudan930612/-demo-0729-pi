# -*- coding: utf-8 -*-
"""地块成片划分 V1 验收补充测试（独立新增，不改动已有测试）。

覆盖验收清单未显式覆盖/需独立强化的边界与异常路径：
  - 无参保地块的村（1.4/3.3 注：记录为 0 且不报错）
  - 未参保地块不参与聚类与归属（不桥接 >200m 空洞，R1）
  - 链式连通：端点 >200m 但经中间地块 ≤200m 链式连通（R1）
  - 单块恰好 50.00 亩不立大户（1.3 注）
  - 累积恰好 500.00 亩不切分（1.3/1.5 边界）
  - 累积超 500 亩切分后各片区仍链式连通（1.5 边界）

断言落在 prepare-policy-confirmation.py 的 generate() 输出 confirmation 结构
（records/spatialReview）与 generate-policy-fixture.py 的 generate() 输出 fixture 结构上，
不测内部聚类函数细节（遵循验收清单 seams 约定）。
"""

import importlib.util
import json
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))


def load_module(name: str, script: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PC = load_module("pc_ext", "prepare-policy-confirmation.py")
GF = load_module("gf_ext", "generate-policy-fixture.py")

OTHER = "330604102018"
GRID = 0.001  # 相邻质心约 96~110m（≤200m）
STEP = 0.0015  # 相邻质心约 145m（≤200m），链式桥接用


def write_parcel_source(path: Path, parcels: list[dict]) -> Path:
    """parcels: [(id, area_mu, lng, lat), ...]"""
    features = []
    for pid, area, lng, lat in parcels:
        features.append({
            "type": "Feature",
            "properties": {"id": pid, "area_m2": round(area * 666.67, 2), "area_mu": area,
                           "label_lng": lng, "label_lat": lat},
            "geometry": {"type": "Polygon", "coordinates": [[[lng, lat], [lng + 0.0005, lat],
                                                             [lng + 0.0005, lat + 0.0005], [lng, lat + 0.0005], [lng, lat]]]},
        })
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
    return path


def grid_source(count: int, area_mu: float, spacing: float = GRID, start_id: int = 1) -> tuple[Path, dict]:
    """生成 count 个地块的网格 GeoJSON，返回 (路径, {id: (lng, lat)})。"""
    tmp = Path(tempfile.mkdtemp())
    src = tmp / "parcels.geojson"
    parcels = []
    points = {}
    cols = int(count ** 0.5) + 1
    for i in range(count):
        pid = start_id + i
        row = i // cols
        col = i % cols
        lng = 120.0 + col * spacing
        lat = 30.0 + row * spacing
        parcels.append((pid, area_mu, lng, lat))
        points[str(pid)] = (lng, lat)
    write_parcel_source(src, parcels)
    return src, points


def make_confirmation(code: str, parcel_ids: list[str], uninsured_ids: set[str]) -> dict:
    return {
        "schemaVersion": "parcel-confirmation-v1",
        "villageCode": code,
        "confirmedAt": "2025-04-01",
        "confirmedBy": "operator-01",
        "assignmentModel": "four-approximate-regions-plus-one-parcel-roster",
        "records": [{"parcelId": pid, "insured": pid not in uninsured_ids,
                     "insuredPartyId": None if pid in uninsured_ids else "party-0001",
                     "confirmedAt": "2025-04-01", "confirmedBy": "operator-01"}
                    for pid in sorted(parcel_ids, key=int)],
        "spatialReview": [],
    }


def run_prepare(code: str, src: Path, out: Path, force: bool = False) -> dict:
    orig = (PC.source_path, PC.output_path)
    PC.source_path = lambda c: src
    PC.output_path = lambda c: out
    try:
        PC.generate(code, force=force)
    finally:
        PC.source_path, PC.output_path = orig
    return json.loads(out.read_text(encoding="utf-8"))


def run_fixture(code: str, src: Path, conf: Path, tmp: Path) -> dict:
    orig = (GF.find_village, GF.parcel_path, GF.confirmation_path, GF.ROOT)
    GF.find_village = lambda c: {"properties": {"code": c, "name": "测试村"}}
    GF.parcel_path = lambda c: src
    GF.confirmation_path = lambda c: conf
    GF.ROOT = tmp
    try:
        GF.generate(code)
    finally:
        GF.find_village, GF.parcel_path, GF.confirmation_path, GF.ROOT = orig
    fx = tmp / "web/src/data" / f"policy-{code}.json"
    return json.loads(fx.read_text(encoding="utf-8"))


def big_farms(data: dict) -> list[dict]:
    return [m for m in data["spatialReview"] if m["insuredPartyId"].startswith("party-")]


def summary(data: dict) -> dict:
    return [m for m in data["spatialReview"] if m["insuredPartyId"] == "coverage-summary"][0]


class ClusterAcceptanceExtendedTest(unittest.TestCase):
    # ---- 无参保地块的村：记录为 0 且不报错（1.4/3.3 注）----
    def test_all_uninsured_village_no_error_and_zero_share(self):
        src, _ = grid_source(50, 2.0)
        tmp = src.parent
        out = tmp / "conf.json"
        un = {str(i) for i in range(1, 51)}
        out.write_text(json.dumps(make_confirmation(OTHER, [str(i) for i in range(1, 51)], un),
                                  ensure_ascii=False), encoding="utf-8")
        data = run_prepare(OTHER, src, out, force=True)
        self.assertTrue(all(not r["insured"] for r in data["records"]))
        self.assertEqual(len(big_farms(data)), 0)
        s = summary(data)
        self.assertEqual(s["bigFarmCount"], 0)
        # 参保面积 0 时覆盖占比不得除零报错
        self.assertEqual(s["bigFarmCoverageShareOfInsuredArea"], 0)
        # fixture 层同样不得报错；团单不含未参保地块（2.2）：0 承保明细、0 清单项
        fixture = run_fixture(OTHER, src, out, tmp)
        self.assertEqual(fixture["parcelCoverages"], [])
        self.assertEqual(fixture["enrollmentItems"], [])
        self.assertEqual(fixture["report"]["bigFarmCount"], 0)
        self.assertEqual(fixture["report"]["bigFarmCoverageShareOfInsuredArea"], 0)

    # ---- 未参保地块不参与聚类与归属：不桥接 >200m 空洞（R1）----
    def test_uninsured_parcel_does_not_bridge_cluster(self):
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "line.geojson"
        # A(40亩) — B(40亩,未参保) — C(40亩)，相邻 150m；A-C 相距 300m>200m
        write_parcel_source(src, [(1, 40.0, 120.0, 30.0),
                                  (2, 40.0, 120.0 + STEP, 30.0),
                                  (3, 40.0, 120.0 + 2 * STEP, 30.0)])
        out = tmp / "conf.json"
        out.write_text(json.dumps(make_confirmation(OTHER, ["1", "2", "3"], {"2"}),
                                  ensure_ascii=False), encoding="utf-8")
        data = run_prepare(OTHER, src, out, force=True)
        # 未参保 B 不得桥接：A、C 无法连通，各自 <50 亩 → 0 大户
        self.assertEqual(len(big_farms(data)), 0)
        parties = {}
        for r in data["records"]:
            if r["insured"]:
                parties[r["parcelId"]] = r["insuredPartyId"]
        self.assertIn("1", parties)
        self.assertIn("3", parties)
        # A、C 必须归属不同 party（未参保 B 未桥接）
        self.assertNotEqual(parties["1"], parties["3"])
        # B 未参保、无归属
        b = [r for r in data["records"] if r["parcelId"] == "2"][0]
        self.assertFalse(b["insured"])
        self.assertIsNone(b["insuredPartyId"])

    # ---- 链式连通：端点 >200m 但经中间地块 ≤200m 仍成一片（R1）----
    def test_chain_connectivity_beyond_200m_endpoints(self):
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "chain.geojson"
        # A-B-C-D 各 40 亩，相邻 150m；A-D 相距 450m>200m，链式连通
        write_parcel_source(src, [(1, 40.0, 120.0, 30.0),
                                  (2, 40.0, 120.0 + STEP, 30.0),
                                  (3, 40.0, 120.0 + 2 * STEP, 30.0),
                                  (4, 40.0, 120.0 + 3 * STEP, 30.0)])
        out = tmp / "conf.json"
        data = run_prepare(OTHER, src, out, force=False)
        farms = big_farms(data)
        self.assertEqual(len(farms), 1)
        self.assertEqual(farms[0]["parcelCount"], 4)
        self.assertEqual(farms[0]["isolatedParcelIds"], [])
        # 累计 160 亩，端点相距 >200m 仍同属一个大户
        self.assertEqual(Decimal(farms[0]["classifiedAreaMu"]), Decimal("160.00"))

    # ---- 单块恰好 50.00 亩不立大户（1.3 注）----
    def test_single_parcel_exactly_50_mu_goes_roster(self):
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "single-50.geojson"
        write_parcel_source(src, [(1, 50.0, 120.0, 30.0)])
        out = tmp / "conf.json"
        data = run_prepare(OTHER, src, out, force=False)
        self.assertEqual(len(big_farms(data)), 0)
        self.assertEqual(summary(data)["bigFarmCount"], 0)
        roster = [m for m in data["spatialReview"] if m["insuredPartyId"] == "roster-one-parcel-per-party"]
        self.assertEqual(len(roster), 1)
        self.assertEqual(roster[0]["parcelCount"], 1)

    # ---- 累积恰好 500.00 亩不切分（1.3/1.5 边界）----
    def test_exactly_500_mu_cluster_not_split(self):
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "parcels.geojson"
        # 100 块 × 5 亩 = 500.00 成片；外加 1 块远处孤立未参保（保证未参保集合非空，force 才可覆盖）
        parcels = [(i, 5.0, 120.0 + ((i - 1) % 10) * GRID, 30.0 + ((i - 1) // 10) * GRID)
                   for i in range(1, 101)]
        parcels.append((101, 2.0, 121.5, 31.5))
        write_parcel_source(src, parcels)
        out = tmp / "conf.json"
        ids = [str(i) for i in range(1, 102)]
        out.write_text(json.dumps(make_confirmation(OTHER, ids, {"101"}), ensure_ascii=False), encoding="utf-8")
        data = run_prepare(OTHER, src, out, force=True)
        farms = big_farms(data)
        self.assertEqual(len(farms), 1)
        self.assertEqual(Decimal(farms[0]["classifiedAreaMu"]), Decimal("500.00"))
        self.assertEqual(farms[0]["isolatedParcelIds"], [])

    # ---- 累积超 500 亩切分，且各片区仍链式连通（1.5 边界）----
    def test_over_500_mu_split_parts_remain_chained(self):
        src, points = grid_source(200, 3.0)
        tmp = src.parent
        out = tmp / "conf.json"
        data = run_prepare(OTHER, src, out, force=False)
        farms = big_farms(data)
        # 200×3≈600 亩（去未参保后仍 >500），必须切分为 ≥2 个片区
        self.assertGreaterEqual(len(farms), 2)
        groups = {}
        for r in data["records"]:
            if r["insured"] and r["insuredPartyId"] and r["insuredPartyId"].startswith("party-"):
                groups.setdefault(r["insuredPartyId"], []).append(r["parcelId"])
        for farm in farms:
            self.assertLessEqual(Decimal(farm["classifiedAreaMu"]), Decimal("500.00"))
            self.assertGreater(Decimal(farm["classifiedAreaMu"]), Decimal("50.00"))
            self.assertEqual(farm["isolatedParcelIds"], [])
            # 每个片区内部独立重算：任意地块到同片区最近邻 ≤200m
            group = groups.get(farm["insuredPartyId"], [])
            self.assertGreaterEqual(len(group), 2)
            for a in group:
                nearest = min(PC.distance(points[a], points[b]) for b in group if b != a)
                self.assertLessEqual(nearest, 200.0, f"{farm['insuredPartyId']} 地块 {a} 最近邻 {nearest:.1f}m >200m")


if __name__ == "__main__":
    unittest.main()

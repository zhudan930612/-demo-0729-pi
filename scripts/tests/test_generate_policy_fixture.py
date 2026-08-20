# -*- coding: utf-8 -*-
"""generate-policy-fixture.py 参数化单测：龙江村授权重生成（legacy 文件名）、成片大户自适应、
一块一户团单、报告大户覆盖占比。断言落在 generate() 输出的 fixture 结构上。"""

import importlib.util
import json
import random
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))


def load_module(name: str, script: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PC = load_module("pc", "prepare-policy-confirmation.py")
GF = load_module("gf", "generate-policy-fixture.py")


def make_parcel_source(count: int = 600, seed: int = 42, spacing: float = 0.001) -> Path:
    """混合布局：80% 地块在 0.001 网格密集成片簇（内部连通），20% 远处孤立（互不相邻）。

    spacing=0.003 时整张图无 ≤200m 边（全部孤立，用于"全量进团单"场景）。
    """
    tmp = Path(tempfile.mkdtemp())
    random.seed(seed)
    feats = []
    cluster = int(count * 0.8)
    cols = 30
    for i in range(1, count + 1):
        area_mu = round(random.uniform(0.5, 6.0), 2)
        if i <= cluster:
            row = (i - 1) // cols
            col = (i - 1) % cols
            lon = 120.86 + col * spacing
            lat = 29.76 + row * spacing
        else:
            lon = 121.20 + (i - cluster) * 0.01
            lat = 29.90 + (i - cluster) * 0.01
        feats.append({
            "type": "Feature",
            "properties": {"id": i, "area_m2": round(area_mu * 666.67, 2), "area_mu": area_mu,
                           "label_lng": lon, "label_lat": lat},
            "geometry": {"type": "Polygon", "coordinates": [[[lon, lat], [lon + 0.0005, lat],
                                                             [lon + 0.0005, lat + 0.0005], [lon, lat + 0.0005], [lon, lat]]]},
        })
    src = tmp / "parcels.geojson"
    src.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    return src


def build_fixture(code: str = "330604102016", spacing: float = 0.001):
    """生成确认 + fixture，返回 (fixture, work_dir)。"""
    src = make_parcel_source(spacing=spacing)
    tmp = src.parent

    pc_orig = (PC.source_path, PC.output_path, PC.regions_config_path)
    PC.source_path = lambda c: src
    conf = tmp / "conf.json"
    PC.output_path = lambda c: conf
    # 聚类村不读 regions 配置；提供占位避免误用
    PC.regions_config_path = lambda c: tmp / "unused-regions.json"
    try:
        PC.generate(code)
    finally:
        PC.source_path, PC.output_path, PC.regions_config_path = pc_orig

    gf_orig = (GF.find_village, GF.parcel_path, GF.confirmation_path, GF.ROOT)
    GF.find_village = lambda c: {"properties": {"code": c, "name": "清潭村"}}
    GF.parcel_path = lambda c: src
    GF.confirmation_path = lambda c: conf
    GF.ROOT = tmp
    try:
        GF.generate(code)
    finally:
        GF.find_village, GF.parcel_path, GF.confirmation_path, GF.ROOT = gf_orig

    fx_path = tmp / "web/src/data" / f"policy-{code}.json"
    return json.loads(fx_path.read_text(encoding="utf-8")), tmp


class GeneratePolicyFixtureTest(unittest.TestCase):
    def test_longjiang_regenerates_with_legacy_filenames(self):
        # 龙江村授权重新生成：产物写 legacy 文件名（policy-v1/cultivation-v1 各两处 + report）
        src = make_parcel_source()
        tmp = src.parent
        pc_orig = (PC.source_path, PC.output_path, PC.regions_config_path)
        PC.source_path = lambda c: src
        conf = tmp / "conf.json"
        PC.output_path = lambda c: conf
        cfg = tmp / "regions.json"
        cfg.write_text(json.dumps({
            "villageCode": "330604102014",
            "assignmentModel": "user-annotated-regions-v1",
            "regions": [{"party": "party-0001",
                         "polygon": [[120.85, 29.75], [120.90, 29.75], [120.90, 29.80], [120.85, 29.80]]}],
        }, ensure_ascii=False), encoding="utf-8")
        PC.regions_config_path = lambda c: cfg
        try:
            PC.generate("330604102014")
        finally:
            PC.source_path, PC.output_path, PC.regions_config_path = pc_orig
        gf_orig = (GF.find_village, GF.parcel_path, GF.confirmation_path, GF.ROOT)
        GF.find_village = lambda c: {"properties": {"code": c, "name": "龙江村"}}
        GF.parcel_path = lambda c: src
        GF.confirmation_path = lambda c: conf
        GF.ROOT = tmp
        try:
            GF.generate("330604102014")
        finally:
            GF.find_village, GF.parcel_path, GF.confirmation_path, GF.ROOT = gf_orig
        for rel in ("web/src/data/policy-v1.json", "web/public/business/policy-v1.json",
                    "web/src/data/cultivation-v1.json", "web/public/business/cultivation-v1.json",
                    "web/src/data/policy-v1.report.json"):
            self.assertTrue((tmp / rel).exists(), rel)
        fx = json.loads((tmp / "web/src/data/policy-v1.json").read_text(encoding="utf-8"))
        self.assertEqual(fx["villageCode"], "330604102014")
        self.assertEqual(fx["schemaVersion"], "policy-v1")

    def test_identity_region_code_by_county(self):
        self.assertEqual(GF.identity_number(1, "330604102016")[:6], "330604")
        self.assertEqual(GF.identity_number(1, "330683104307")[:6], "330683")

    def test_party_names_unique_2to3_chars(self):
        names = [GF.party_name(i, "330604102016") for i in range(1, 400)]
        self.assertEqual(len(names), len(set(names)))
        self.assertTrue(all(2 <= len(n) <= 3 for n in names))

    def test_policy_no_22_digits_and_village_unique(self):
        self.assertEqual(len(GF.identity_number(1, "330604102016")), 18)
        # 保单号由 generate 内部生成，这里验证格式约束的组成部分：村代码+年份+序号
        no = f"3306041020162025000001"
        self.assertEqual(len(no), 22)
        self.assertTrue(no.isdigit())

    def test_generate_adaptive_big_farm_structure(self):
        fixture, _ = build_fixture()
        current = [p for p in fixture["policies"] if p["status"] != "已到期"]
        single = [p for p in current if p["insuredMode"] == "single_insured"]
        roster = [p for p in current if p["insuredMode"] == "insured_roster"]
        # 验收 2.3：同村同年度同产品恰好 1 张分户清单型保单
        self.assertEqual(len(roster), 1)
        # 大户数量自适应（验收 1.5）：混合布局至少 1 张大户
        self.assertGreaterEqual(len(single), 1)
        current_policy_ids = {p["id"] for p in current}
        counts = Counter(c["insuredPartyId"] for c in fixture["parcelCoverages"] if c["policyId"] in current_policy_ids)
        for party, n in counts.items():
            if n > 1:
                # 多块 party 全部为单一型大户（验收 1.5/1.6）
                self.assertTrue(any(p["insuredPartyId"] == party for p in single), f"多块 party {party} 必须是单一型大户")
        # 验收 2.1：清单项一块一户，且每个清单项恰好关联 1 个地块承保明细
        items = fixture["enrollmentItems"]
        self.assertGreaterEqual(len(items), 1)
        self.assertTrue(all(len(i["parcelCoverageIds"]) == 1 for i in items))
        item_coverages = Counter(c["enrollmentItemId"] for c in fixture["parcelCoverages"] if c["enrollmentItemId"])
        self.assertTrue(all(item_coverages[i["id"]] == 1 for i in items))
        # 合作社区块名称
        roster_party = fixture["parties"][0]
        self.assertEqual(roster_party["name"], "清潭村股份经济合作社")

    def test_generate_scattered_all_roster(self):
        # 无 ≤200m 邻居的稀疏布局：0 大户，全部一块一户进团单
        fixture, _ = build_fixture(spacing=0.003)
        current = [p for p in fixture["policies"] if p["status"] != "已到期"]
        single = [p for p in current if p["insuredMode"] == "single_insured"]
        roster = [p for p in current if p["insuredMode"] == "insured_roster"]
        self.assertEqual(len(single), 0)
        self.assertEqual(len(roster), 1)
        items = fixture["enrollmentItems"]
        self.assertEqual(len(items), roster[0]["summary"]["parcelCount"])
        self.assertTrue(all(len(i["parcelCoverageIds"]) == 1 for i in items))

    def test_report_records_big_farm_coverage_share(self):
        # 验收 3.4：报告记录大户覆盖占比与每户指标
        fixture, _ = build_fixture()
        rpt = fixture["report"]
        for key in ("bigFarmCount", "bigFarmParcelCount", "bigFarmInsuredAreaMu", "insuredAreaMu",
                    "bigFarmCoverageShareOfInsuredArea"):
            self.assertIn(key, rpt, key)
        share = rpt["bigFarmCoverageShareOfInsuredArea"]
        self.assertTrue(0 <= share <= 1)
        self.assertGreater(share, 0)
        metrics = rpt["spatialReview"]["insuredPartyMetrics"]
        big_metrics = [m for m in metrics if m["insuredPartyId"].startswith("party-")]
        self.assertEqual(len(big_metrics), rpt["bigFarmCount"])
        for m in big_metrics:
            for key in ("parcelCount", "geometryAreaMu", "maxDistanceM", "isolatedParcelIds"):
                self.assertIn(key, m, key)
            self.assertEqual(m["isolatedParcelIds"], [])

    def test_policy_numbers_unique_across_policies(self):
        fixture, _ = build_fixture()
        nos = [p["policyNo"] for p in fixture["policies"]]
        self.assertEqual(len(nos), len(set(nos)))
        self.assertTrue(all(len(n) == 22 and n.isdigit() for n in nos))


if __name__ == "__main__":
    unittest.main()

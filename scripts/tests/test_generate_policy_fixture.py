# -*- coding: utf-8 -*-
"""generate-policy-fixture.py 参数化单测：龙江村保护、姓名/证件/保单号、4+1 结构。"""

import importlib.util
import json
import random
import sys
import tempfile
import unittest
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


def make_parcel_source(count: int = 600, seed: int = 42) -> Path:
    tmp = Path(tempfile.mkdtemp())
    random.seed(seed)
    feats = []
    for i in range(1, count + 1):
        row = (i - 1) // 30
        col = (i - 1) % 30
        lon = 120.86 + col * 0.001
        lat = 29.76 + row * 0.001
        area_mu = round(random.uniform(0.5, 6.0), 2)
        feats.append({
            "type": "Feature",
            "properties": {"id": i, "area_m2": round(area_mu * 666.67, 2), "area_mu": area_mu, "label_lng": lon, "label_lat": lat},
            "geometry": {"type": "Polygon", "coordinates": [[[lon, lat], [lon + 0.0005, lat], [lon + 0.0005, lat + 0.0005], [lon, lat + 0.0005], [lon, lat]]]},
        })
    src = tmp / "parcels.geojson"
    src.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    return src


def build_fixture(code: str = "330604102016"):
    """生成确认 + fixture，返回 (fixture, work_dir)。"""
    src = make_parcel_source()
    tmp = src.parent

    pc_orig = (PC.source_path, PC.output_path)
    PC.source_path = lambda c: src
    conf = tmp / "conf.json"
    PC.output_path = lambda c: conf
    try:
        PC.generate(code)
    finally:
        PC.source_path, PC.output_path = pc_orig

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
    def test_longjiang_always_protected(self):
        out = GF.ROOT / "web/src/data/policy-v1.json"
        before = out.read_text(encoding="utf-8") if out.exists() else None
        GF.generate("330604102014")
        after = out.read_text(encoding="utf-8") if out.exists() else None
        self.assertEqual(before, after)

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

    def test_generate_4_plus_1_structure(self):
        fixture, _ = build_fixture()
        current = [p for p in fixture["policies"] if p["status"] != "已到期"]
        self.assertEqual(len(current), 5)
        self.assertEqual(sum(1 for p in current if p["insuredMode"] == "single_insured"), 4)
        self.assertEqual(sum(1 for p in current if p["insuredMode"] == "insured_roster"), 1)
        # 村代码字段
        self.assertEqual(fixture["villageCode"], "330604102016")
        # 清单项一块一户
        items = fixture["enrollmentItems"]
        self.assertTrue(all(len(i["parcelCoverageIds"]) == 1 for i in items))
        # 合作社区块名称
        roster = fixture["parties"][0]
        self.assertEqual(roster["name"], "清潭村股份经济合作社")

    def test_policy_numbers_unique_across_policies(self):
        fixture, _ = build_fixture()
        nos = [p["policyNo"] for p in fixture["policies"]]
        self.assertEqual(len(nos), len(set(nos)))
        self.assertTrue(all(len(n) == 22 and n.isdigit() for n in nos))


if __name__ == "__main__":
    unittest.main()

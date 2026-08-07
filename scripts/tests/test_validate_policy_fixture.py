# -*- coding: utf-8 -*-
"""validate-policy-fixture.py 参数化单测：龙江村宽松、新村严格、路径发现。"""

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
VF = load_module("vf", "validate-policy-fixture.py")


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


def build_fixture(code: str = "330604102016", count: int = 600):
    src = make_parcel_source(count)
    tmp = src.parent
    # 复制 parcels 到 VF.ROOT 期望位置（web/public/data/parcels/{code}.geojson）
    parcel_dest = tmp / "web/public/data/parcels" / f"{code}.geojson"
    parcel_dest.parent.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copy(src, parcel_dest)

    pc_orig = (PC.source_path, PC.output_path)
    PC.source_path = lambda c: parcel_dest
    conf = tmp / "web/src/data" / f"parcel-confirmation-{code}.json"
    conf.parent.mkdir(parents=True, exist_ok=True)
    PC.output_path = lambda c: conf
    try:
        PC.generate(code)
    finally:
        PC.source_path, PC.output_path = pc_orig

    gf_orig = (GF.find_village, GF.parcel_path, GF.confirmation_path, GF.ROOT)
    GF.find_village = lambda c: {"properties": {"code": c, "name": "清潭村"}}
    GF.parcel_path = lambda c: parcel_dest
    GF.confirmation_path = lambda c: conf
    GF.ROOT = tmp
    try:
        GF.generate(code)
    finally:
        GF.find_village, GF.parcel_path, GF.confirmation_path, GF.ROOT = gf_orig
    return tmp, code


class ValidatePolicyFixtureTest(unittest.TestCase):
    def test_fixture_paths_longjiang_legacy_names(self):
        policy, cult, parcel, confirm = VF.fixture_paths("330604102014")
        self.assertEqual(policy.name, "policy-v1.json")
        self.assertEqual(cult.name, "cultivation-v1.json")
        self.assertEqual(confirm.name, "parcel-confirmation-v1.json")

    def test_fixture_paths_new_village(self):
        policy, cult, parcel, confirm = VF.fixture_paths("330604102016")
        self.assertEqual(policy.name, "policy-330604102016.json")
        self.assertEqual(confirm.name, "parcel-confirmation-330604102016.json")

    def test_valid_identity_and_luhn(self):
        self.assertTrue(VF.valid_identity("330604197601221121"))
        self.assertTrue(VF.valid_luhn("6217993323793116731"))
        self.assertFalse(VF.valid_identity("33060419760122112X"))
        self.assertFalse(VF.valid_luhn("6217993323793116730"))

    def test_strict_validation_passes_for_new_village(self):
        tmp, code = build_fixture()
        vf_orig = (VF.DATA, VF.ROOT)
        VF.DATA = tmp / "web/src/data"
        VF.ROOT = tmp
        try:
            VF.validate_village(code, strict=True)
        finally:
            VF.DATA, VF.ROOT = vf_orig

    def test_longjiang_loose_validation_passes(self):
        vf_orig = (VF.DATA, VF.ROOT)
        VF.DATA = SCRIPTS.parent / "web/src/data"
        VF.ROOT = SCRIPTS.parent
        try:
            VF.validate_village("330604102014", strict=False)
        finally:
            VF.DATA, VF.ROOT = vf_orig

    def test_discover_village_codes_excludes_v1(self):
        tmp = Path(tempfile.mkdtemp())
        (tmp / "web/src/data").mkdir(parents=True)
        (tmp / "web/src/data" / "policy-v1.json").write_text("{}", encoding="utf-8")
        (tmp / "web/src/data" / "policy-330604102016.json").write_text("{}", encoding="utf-8")
        (tmp / "web/src/data" / "policy-330683104307.json").write_text("{}", encoding="utf-8")
        (tmp / "web/src/data" / "policy-bad.txt").write_text("{}", encoding="utf-8")
        vf_orig = VF.DATA
        VF.DATA = tmp / "web/src/data"
        try:
            codes = VF.discover_village_codes()
        finally:
            VF.DATA = vf_orig
        self.assertEqual(codes, ["330604102016", "330683104307"])


if __name__ == "__main__":
    unittest.main()

# -*- coding: utf-8 -*-
"""prepare-policy-confirmation.py 参数化单测：龙江村保护、确定性未参保、四区划分。"""

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
SCRIPT = SCRIPTS / "prepare-policy-confirmation.py"
SPEC = importlib.util.spec_from_file_location("prepare_policy_confirmation", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def make_parcel_source(count: int) -> Path:
    """在临时目录生成 count 个地块的 GeoJSON（1×1 度网格，覆盖四区分布）。"""
    tmp = Path(tempfile.mkdtemp())
    src = tmp / f"{count}.geojson"
    features = []
    for i in range(1, count + 1):
        # 在 10×10 网格中铺开，让四区都有地块
        row = (i - 1) // 10
        col = (i - 1) % 10
        lon = 120.0 + col * 0.01
        lat = 30.0 + row * 0.01
        features.append({
            "type": "Feature",
            "properties": {"id": i, "area_m2": 1000.0, "area_mu": 1.5, "label_lng": lon, "label_lat": lat},
            "geometry": {"type": "Polygon", "coordinates": [[[lon, lat], [lon + 0.005, lat], [lon + 0.005, lat + 0.005], [lon, lat + 0.005], [lon, lat]]]},
        })
    src.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
    return src


class PreparePolicyConfirmationTest(unittest.TestCase):
    def test_longjiang_always_protected(self):
        # 龙江村现有确认文件必须受保护，--force 也不能覆盖
        out = MODULE.output_path("330604102014")
        before = out.read_text(encoding="utf-8") if out.exists() else None
        MODULE.generate("330604102014", force=False)
        MODULE.generate("330604102014", force=True)
        after = out.read_text(encoding="utf-8") if out.exists() else None
        self.assertEqual(before, after)

    def test_deterministic_uninsured_share_within_10pct(self):
        for count in (200, 1533, 1000):
            ids = [str(i) for i in range(1, count + 1)]
            uninsured = MODULE.deterministic_uninsured(ids)
            self.assertLessEqual(len(uninsured) / count, 0.10)
            self.assertGreater(len(uninsured), 0)

    def test_output_path_by_village(self):
        self.assertEqual(MODULE.output_path("330604102014").name, "parcel-confirmation-v1.json")
        self.assertEqual(MODULE.output_path("330604102016").name, "parcel-confirmation-330604102016.json")

    def test_region_index_matches_longjiang_rule(self):
        # 与龙江村原规则一致：西部带 / 北部带 / 西南带 / 东部带
        self.assertEqual(MODULE.region_index(0.3, 0.4), 0)
        self.assertEqual(MODULE.region_index(0.3, 0.1), 1)
        self.assertEqual(MODULE.region_index(0.2, 0.7), 2)
        self.assertEqual(MODULE.region_index(0.6, 0.4), 3)
        self.assertIsNone(MODULE.region_index(0.9, 0.9))

    def test_generate_creates_4_plus_1_confirmation(self):
        src = make_parcel_source(200)
        # 使用临时源验证生成逻辑：需要猴子补丁 source_path
        original_source_path = MODULE.source_path
        original_output_path = MODULE.output_path
        tmp_out = src.parent / "confirmation-test.json"
        try:
            MODULE.source_path = lambda code: src
            MODULE.output_path = lambda code: tmp_out
            MODULE.generate("330604102016")
            data = json.loads(tmp_out.read_text(encoding="utf-8"))
            self.assertEqual(data["villageCode"], "330604102016")
            self.assertEqual(len(data["records"]), 200)
            metrics = data["spatialReview"]
            four_regions = [m for m in metrics if m["insuredPartyId"].startswith("party-")]
            self.assertEqual(len(four_regions), 4)
            roster = [m for m in metrics if m["insuredPartyId"] == "roster-one-parcel-per-party"]
            self.assertEqual(len(roster), 1)
        finally:
            MODULE.source_path = original_source_path
            MODULE.output_path = original_output_path


if __name__ == "__main__":
    unittest.main()

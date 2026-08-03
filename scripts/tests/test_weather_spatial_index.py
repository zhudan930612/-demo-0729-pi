# -*- coding: utf-8 -*-

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from weather_spatial_index import (  # noqa: E402
    WeatherSpatialIndexError,
    build_weather_spatial_index,
    load_trusted_weather_spatial_index,
    write_weather_spatial_index,
)


def polygon(x0, y0, x1, y1):
    return {
        "type": "Polygon",
        "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
    }


def feature(code, name, geometry):
    return {
        "type": "Feature",
        "properties": {"code": code, "name": name},
        "geometry": geometry,
    }


def write_json(root: Path, relative: str, value):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def collection(*features):
    return {"type": "FeatureCollection", "features": list(features)}


def create_fixture(root: Path):
    """五级、纯虚构矩形 fixture；不包含真实行政边界或坐标。"""
    write_json(root, "manifest.json", {
        "province": {"code": "330000", "name": "测试省"},
        "cities": [{
            "code": "330100", "name": "测试市",
            "counties": [{
                "code": "330101", "name": "测试县",
                "townships": [{"code": "330101001000", "name": "测试乡"}],
            }],
        }],
    })
    write_json(root, "boundary/province.geojson", collection(feature("330000", "测试省", polygon(0, 0, 10, 10))))
    write_json(root, "boundary/city/330000.geojson", collection(feature("330100", "测试市", polygon(1, 1, 9, 9))))
    write_json(root, "boundary/county/330100.geojson", collection(feature("330101", "测试县", polygon(2, 2, 8, 8))))
    write_json(root, "boundary/township/330101.geojson", collection(feature("330101001000", "测试乡", polygon(3, 3, 7, 7))))
    write_json(root, "villages/330101001000.geojson", collection(feature("330101001001", "测试村", polygon(4, 4, 6, 6))))
    write_json(root, "allowlist.json", {"schemaVersion": 1, "sourceType": "测试", "source": {"url": "https://example.test", "publisher": "测试", "accessed": "2026-08-03", "reason": "测试"}, "entries": []})


class WeatherSpatialIndexTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name)
        create_fixture(self.data)

    def tearDown(self):
        self.temp.cleanup()

    def test_preprocessor_removes_legacy_public_weather_index(self):
        source = (SCRIPTS / "prepare-boundaries.py").read_text(encoding="utf-8")
        self.assertIn("shutil.rmtree(OUT / 'weather', ignore_errors=True)", source)

    def test_builds_complete_five_level_tree_and_village(self):
        index = build_weather_spatial_index(self.data, self.data / "allowlist.json")
        by_code = {node["code"]: node for node in index["nodes"]}
        self.assertEqual(
            [by_code[code]["level"] for code in ("330000", "330100", "330101", "330101001000", "330101001001")],
            ["province", "city", "county", "township", "village"],
        )
        self.assertEqual(by_code["330101001001"]["parentCode"], "330101001000")
        self.assertEqual(by_code["330101001000"]["childrenCodes"], ["330101001001"])
        self.assertEqual(by_code["330101001001"]["boundary"]["path"], "villages/330101001000.geojson")

    def test_generated_representative_points_are_covered_by_final_boundaries(self):
        write_weather_spatial_index(self.data, self.data / "private", self.data / "allowlist.json")
        nodes = load_trusted_weather_spatial_index(self.data / "private")
        self.assertEqual(len(nodes), 5)

    def test_invalid_geometry_fails_closed(self):
        bow_tie = {
            "type": "Polygon",
            "coordinates": [[[3, 3], [7, 7], [7, 3], [3, 7], [3, 3]]],
        }
        write_json(
            self.data,
            "boundary/township/330101.geojson",
            collection(feature("330101001000", "测试乡", bow_tie)),
        )
        with self.assertRaisesRegex(WeatherSpatialIndexError, "为空或无效"):
            build_weather_spatial_index(self.data, self.data / "allowlist.json")

    def test_disjoint_child_geometry_fails_closed(self):
        write_json(
            self.data,
            "villages/330101001000.geojson",
            collection(feature("330101001001", "测试村", polygon(20, 20, 21, 21))),
        )
        with self.assertRaisesRegex(WeatherSpatialIndexError, "与父级完全不相交"):
            build_weather_spatial_index(self.data, self.data / "allowlist.json")

    def test_missing_village_allowlist_must_match_exactly(self):
        (self.data / "villages/330101001000.geojson").unlink()
        with self.assertRaisesRegex(WeatherSpatialIndexError, "无村界乡镇集合漂移"):
            build_weather_spatial_index(self.data, self.data / "allowlist.json")

    def test_duplicate_code_with_conflicting_names_fails_closed(self):
        village_path = "villages/330101001000.geojson"
        write_json(
            self.data,
            village_path,
            collection(
                feature("330101001001", "测试村甲", polygon(4, 4, 5, 5)),
                feature("330101001001", "测试村乙", polygon(5, 5, 6, 6)),
            ),
        )
        with self.assertRaisesRegex(WeatherSpatialIndexError, "空、重复代码或空名称"):
            build_weather_spatial_index(self.data, self.data / "allowlist.json")

    def test_missing_boundary_fails_closed(self):
        (self.data / "boundary/county/330100.geojson").unlink()
        with self.assertRaisesRegex(WeatherSpatialIndexError, "无法读取 JSON"):
            build_weather_spatial_index(self.data, self.data / "allowlist.json")

    def test_corrupt_index_and_outside_point_fail_closed(self):
        index_path = write_weather_spatial_index(self.data, self.data / "private", self.data / "allowlist.json")
        index_path.write_text("{not-json", encoding="utf-8")
        with self.assertRaisesRegex(WeatherSpatialIndexError, "无法读取 JSON"):
            load_trusted_weather_spatial_index(self.data / "private")

        write_weather_spatial_index(self.data, self.data / "private", self.data / "allowlist.json")
        index = json.loads(index_path.read_text(encoding="utf-8"))
        village = next(node for node in index["nodes"] if node["level"] == "village")
        village["representativePoint"] = [0, 0]
        index_path.write_text(json.dumps(index), encoding="utf-8")
        with self.assertRaisesRegex(WeatherSpatialIndexError, "不在自身、父链和浙江省界共同范围内"):
            load_trusted_weather_spatial_index(self.data / "private")


if __name__ == "__main__":
    unittest.main()

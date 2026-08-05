# -*- coding: utf-8 -*-
"""scripts/check-government-seats.py 的单元测试（纯虚构 fixture，不含真实坐标）。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

# 脚本文件名含连字符（与 check-codes.py 一致），不能直接 import，用 importlib 按路径加载。
import importlib.util  # noqa: E402

_checker_path = SCRIPTS / "check-government-seats.py"
_spec = importlib.util.spec_from_file_location("check_government_seats", _checker_path)
_checker = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_checker)

GovernmentSeatsError = _checker.GovernmentSeatsError
validate_seats = _checker.validate_seats
DEFAULT_DATA_DIR = _checker.DEFAULT_DATA_DIR
DEFAULT_SEATS_FILE = _checker.DEFAULT_SEATS_FILE
ROOT = Path(__file__).resolve().parents[2]


def polygon(x0, y0, x1, y1):
    return {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}


def feature(code, name, geometry):
    return {"type": "Feature", "properties": {"code": code, "name": name}, "geometry": geometry}


def write_json(root: Path, relative: str, value):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def collection(*features):
    return {"type": "FeatureCollection", "features": list(features)}


def create_index(root: Path):
    """省/市/县/乡镇四层矩形 fixture；乡镇含 3 个（1 个将越界）。"""
    write_json(root, "weather/index-v2.json", {
        "schemaVersion": 2, "provinceCode": "330000",
        "nodes": [
            {"code": "330000", "name": "测试省", "level": "province", "parentCode": None, "childrenCodes": ["330100"], "representativePoint": [5, 5], "boundary": {"path": "boundary/province.geojson", "featureCode": "330000"}},
            {"code": "330100", "name": "测试市", "level": "city", "parentCode": "330000", "childrenCodes": ["330101"], "representativePoint": [5, 5], "boundary": {"path": "boundary/city/330000.geojson", "featureCode": "330100"}},
            {"code": "330101", "name": "测试县", "level": "county", "parentCode": "330100", "childrenCodes": ["330101001000", "330101002000", "330101003000"], "representativePoint": [5, 5], "boundary": {"path": "boundary/county/330100.geojson", "featureCode": "330101"}},
            {"code": "330101001000", "name": "测试乡甲", "level": "township", "parentCode": "330101", "childrenCodes": [], "representativePoint": [4, 4], "boundary": {"path": "boundary/township/330101.geojson", "featureCode": "330101001000"}},
            {"code": "330101002000", "name": "测试乡乙", "level": "township", "parentCode": "330101", "childrenCodes": [], "representativePoint": [5, 5], "boundary": {"path": "boundary/township/330101.geojson", "featureCode": "330101002000"}},
            {"code": "330101003000", "name": "测试乡丙", "level": "township", "parentCode": "330101", "childrenCodes": [], "representativePoint": [6, 6], "boundary": {"path": "boundary/township/330101.geojson", "featureCode": "330101003000"}},
            {"code": "330101003001", "name": "测试村", "level": "village", "parentCode": "330101003000", "childrenCodes": [], "representativePoint": [6, 6], "boundary": {"path": "villages/330101003000.geojson", "featureCode": "330101003001"}},
        ],
    })
    write_json(root, "boundary/province.geojson", collection(feature("330000", "测试省", polygon(0, 0, 10, 10))))
    write_json(root, "boundary/city/330000.geojson", collection(feature("330100", "测试市", polygon(1, 1, 9, 9))))
    write_json(root, "boundary/county/330100.geojson", collection(feature("330101", "测试县", polygon(2, 2, 8, 8))))
    write_json(root, "boundary/township/330101.geojson", collection(
        feature("330101001000", "测试乡甲", polygon(3, 3, 5, 5)),
        feature("330101002000", "测试乡乙", polygon(5, 3, 6, 5)),
        feature("330101003000", "测试乡丙", polygon(6, 3, 8, 5)),
    ))
    write_json(root, "villages/330101003000.geojson", collection(feature("330101003001", "测试村", polygon(6, 3, 8, 5))))


def write_seats(root: Path, entries):
    write_json(root, "seats.json", {
        "schemaVersion": 1, "provinceCode": "330000", "entries": entries,
    })


def base_entries():
    return [
        {"code": "330000", "name": "测试省", "level": "province", "point": [5.0, 5.0], "score": 99, "status": "candidate"},
        {"code": "330100", "name": "测试市", "level": "city", "point": [5.0, 5.0], "score": 100, "status": "candidate"},
        {"code": "330101", "name": "测试县", "level": "county", "point": [5.0, 5.0], "score": 100, "status": "candidate"},
        {"code": "330101001000", "name": "测试乡甲", "level": "township", "point": [4.0, 4.0], "score": 60, "status": "candidate"},
        {"code": "330101002000", "name": "测试乡乙", "level": "township", "point": [5.5, 4.0], "score": 60, "status": "candidate"},
        {"code": "330101003000", "name": "测试乡丙", "level": "township", "point": [30.0, 30.0], "score": 60, "status": "candidate"},
    ]


class GovernmentSeatsCheckTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name)
        create_index(self.data)
        self.seats = self.data / "seats.json"
        write_seats(self.data, base_entries())

    def tearDown(self):
        self.temp.cleanup()

    def test_valid_fixture_reports_usable_and_excluded(self):
        result = validate_seats(self.seats, self.data)
        self.assertEqual(result["total"], 6)
        self.assertEqual(result["usableByLevel"], {"province": 1, "city": 1, "county": 1, "township": 2})
        self.assertEqual(result["excludedByBoundary"]["count"], 1)
        self.assertEqual(result["excludedByBoundary"]["codes"], ["330101003000"])
        self.assertEqual(result["children"]["citiesUnderProvince"], 1)
        self.assertEqual(result["children"]["usableMaxTownshipsInCounty"], 2)

    def test_name_mismatch_fails(self):
        entries = base_entries()
        entries[3]["name"] = "错名乡"
        write_seats(self.data, entries)
        with self.assertRaisesRegex(GovernmentSeatsError, "名称/层级冲突"):
            validate_seats(self.seats, self.data)

    def test_extra_code_not_in_index_fails(self):
        entries = base_entries()
        entries.append({"code": "330199", "name": "不存在", "level": "city", "point": [5.0, 5.0], "score": 100, "status": "candidate"})
        write_seats(self.data, entries)
        with self.assertRaisesRegex(GovernmentSeatsError, "索引之外的代码"):
            validate_seats(self.seats, self.data)

    def test_duplicate_code_fails(self):
        entries = base_entries()
        entries.append(dict(entries[4]))
        write_seats(self.data, entries)
        with self.assertRaisesRegex(GovernmentSeatsError, "重复"):
            validate_seats(self.seats, self.data)

    def test_low_score_city_fails(self):
        entries = base_entries()
        entries[1]["score"] = 98
        write_seats(self.data, entries)
        with self.assertRaisesRegex(GovernmentSeatsError, "低于 city 门槛"):
            validate_seats(self.seats, self.data)

    def test_low_score_township_fails(self):
        entries = base_entries()
        entries[3]["score"] = 59
        write_seats(self.data, entries)
        with self.assertRaisesRegex(GovernmentSeatsError, "低于 township 门槛"):
            validate_seats(self.seats, self.data)

    def test_candidate_requires_finite_point(self):
        entries = base_entries()
        entries[4]["point"] = [float("nan"), 4.0]
        write_seats(self.data, entries)
        with self.assertRaisesRegex(GovernmentSeatsError, "不是有限数值对"):
            validate_seats(self.seats, self.data)

    def test_invalid_status_fails(self):
        entries = base_entries()
        entries[4]["status"] = "weird"
        write_seats(self.data, entries)
        with self.assertRaisesRegex(GovernmentSeatsError, "状态无效"):
            validate_seats(self.seats, self.data)

    def test_unresolved_township_is_skipped_not_failed(self):
        entries = base_entries()
        entries[5]["status"] = "unresolved"
        entries[5]["point"] = None
        write_seats(self.data, entries)
        result = validate_seats(self.seats, self.data)
        self.assertEqual(result["byStatus"]["unresolved"], 1)
        self.assertEqual(result["excludedByBoundary"]["count"], 0)

    def test_default_paths_exist_in_repo(self):
        self.assertTrue(DEFAULT_SEATS_FILE.exists(), "默认政府驻地表不存在")
        self.assertTrue(DEFAULT_DATA_DIR.exists(), "默认天气数据目录不存在")


if __name__ == "__main__":
    unittest.main()

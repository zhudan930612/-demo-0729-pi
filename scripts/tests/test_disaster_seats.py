# -*- coding: utf-8 -*-
"""scripts/prepare-village-seats.py 的单元测试（小样本几何，无网络）。"""

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("prepare_village_seats", SCRIPTS / "prepare-village-seats.py")
_seats = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_seats)
build_point_index = _seats.build_point_index
join_seat = _seats.join_seat


def square_geom(minx, miny, size=1.0):
    return {"type": "Polygon", "coordinates": [
        [[minx, miny], [minx + size, miny], [minx + size, miny + size],
         [minx, miny + size], [minx, miny]]]}


def pts(*items):
    return list(items)


class TestJoinSeat(unittest.TestCase):
    def test_in_polygon_seat(self):
        # 点位 (0.5,0.5) 落在村面内 → seat
        points = pts(("县A", "乡A", "甲村", 0.5, 0.5))
        idx = build_point_index(points)
        lon, lat, src = join_seat(square_geom(0, 0), "甲村", ("县A", "乡A"), idx)
        self.assertEqual(src, "seat")
        self.assertAlmostEqual(lon, 0.5)

    def test_name_match(self):
        # 点位在面外（小村面）但同县同乡名称匹配（归一化后）且在 0.05° 内 → name
        points = pts(("县A", "乡A", "五堡社区", 0.055, 0.01))  # 村面 [0,0]-[0.02,0.02]，点在面外 0.045°
        idx = build_point_index(points)
        lon, lat, src = join_seat(square_geom(0, 0, 0.02), "五堡村", ("县A", "乡A"), idx)
        self.assertEqual(src, "name")

    def test_name_radius_rejected(self):
        # 名称匹配但点位距质心超 0.05° → 不采用 name（走后续）
        points = pts(("县A", "乡A", "五堡社区", 2.0, 2.0))
        idx = build_point_index(points)
        lon, lat, src = join_seat(square_geom(0, 0), "五堡村", ("县A", "乡A"), idx)
        self.assertNotEqual(src, "name")

    def test_nearest_fallback(self):
        # 面内无点、名称不匹配 → 1.5km 内最近点 → nearest
        # 小村面 [0,0]-[0.02,0.02]，点位 (0.021, 0.01) 面外 0.011°≈1.2km <1.5km
        points = pts(("县A", "乡A", "别村", 0.021, 0.01))
        idx = build_point_index(points)
        lon, lat, src = join_seat(square_geom(0, 0, 0.02), "甲村", ("县A", "乡A"), idx)
        self.assertEqual(src, "nearest")

    def test_centroid_fallback(self):
        # 所有点位都太远（>1.5km）→ centroid
        points = pts(("县A", "乡A", "别村", 5.0, 5.0))
        idx = build_point_index(points)
        lon, lat, src = join_seat(square_geom(0, 0), "甲村", ("县A", "乡A"), idx)
        self.assertEqual(src, "centroid")
        self.assertAlmostEqual(lon, 0.5, delta=0.01)
        self.assertAlmostEqual(lat, 0.5, delta=0.01)

    def test_seat_priority_over_name(self):
        # 面内有位 + 名称匹配两个点位 → 取面内（seat），顺序不可调换
        points = pts(("县A", "乡A", "甲村", 0.9, 0.9),   # 面外同名（近）
                     ("县A", "乡A", "其他", 0.5, 0.5))   # 面内异名
        idx = build_point_index(points)
        lon, lat, src = join_seat(square_geom(0, 0), "甲村", ("县A", "乡A"), idx)
        self.assertEqual(src, "seat")
        self.assertAlmostEqual(lon, 0.5)


if __name__ == "__main__":
    unittest.main()

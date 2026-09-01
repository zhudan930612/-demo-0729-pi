# -*- coding: utf-8 -*-
"""scripts/generate-disaster-warnings.py 的纯函数单元测试（小样本，无网络）。"""

import json
import sys
import unittest
from pathlib import Path

import numpy as np

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

# 脚本文件名含连字符，不能直接 import，用 importlib 按路径加载（与既有测试一致）
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("generate_disaster_warnings", SCRIPTS / "generate-disaster-warnings.py")
_gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gen)
build_future24_matrix = _gen.build_future24_matrix
build_bavi_demo_levels = _gen.build_bavi_demo_levels
build_warnings_json = _gen.build_warnings_json
calibration_report = _gen.calibration_report
compute_warnings = _gen.compute_warnings
ever_tier_counts = _gen.ever_tier_counts
hour_index = _gen.hour_index
nearest_grid_index = _gen.nearest_grid_index


def make_precip_grid(nodes):
    """nodes: [(lat, lon, hourly_list)] → precip.json 结构。"""
    return [{"lat": lat, "lon": lon, "hourly": list(hours),
             "cum": [], "cumHourly": []} for lat, lon, hours in nodes]


class TestHourIndex(unittest.TestCase):
    def test_offsets(self):
        self.assertEqual(hour_index("2026-07-09 00:00:00"), 0)
        self.assertEqual(hour_index("2026-07-09 02:00:00"), 2)
        self.assertEqual(hour_index("2026-07-10 00:00:00"), 24)
        self.assertEqual(hour_index("2026-07-13 00:00:00"), 96)


class TestNearestGrid(unittest.TestCase):
    def test_nearest(self):
        lons = np.array([120.0, 121.0])
        lats = np.array([30.0, 30.0])
        cl = np.array([120.4])
        ca = np.array([30.0])
        gi = nearest_grid_index(cl, ca, lons, lats)
        self.assertEqual(gi.tolist(), [0])

    def test_lon_scale_applied(self):
        # 0.88 经度缩放：121.0 vs 120.0，中心 120.3 → 应选 120.0
        lons = np.array([120.0, 121.0])
        lats = np.array([30.0, 30.0])
        gi = nearest_grid_index(np.array([120.3]), np.array([30.0]), lons, lats)
        self.assertEqual(gi.tolist(), [0])


class TestFuture24(unittest.TestCase):
    def test_basic_window(self):
        # 单节点 120h 序列，每小时降水 1mm；node 在 7/9 00:00 → 未来24h = 24mm
        hourly = [1.0] * 120
        grid = make_precip_grid([(27.0, 118.0, hourly)])
        node_times = ["2026-07-09 00:00:00"]
        fut = build_future24_matrix(grid, node_times, np.array([0]))
        self.assertEqual(fut.shape, (1, 1))
        self.assertAlmostEqual(float(fut[0, 0]), 24.0, delta=0.01)

    def test_later_node(self):
        # 节点 7/10 00:00（i=24）：未来24h = 累计到 48 - 累计到 24 = 24mm
        hourly = [1.0] * 120
        grid = make_precip_grid([(27.0, 118.0, hourly)])
        fut = build_future24_matrix(grid, ["2026-07-10 00:00:00"], np.array([0]))
        self.assertAlmostEqual(float(fut[0, 0]), 24.0, delta=0.01)

    def test_edge_last_node(self):
        # 末节点 7/13 00:00（i=96）：未来24h 需 i+24=120 恰为序列末尾（有 121 前缀和）
        hourly = [1.0] * 120
        grid = make_precip_grid([(27.0, 118.0, hourly)])
        fut = build_future24_matrix(grid, ["2026-07-13 00:00:00"], np.array([0]))
        self.assertAlmostEqual(float(fut[0, 0]), 24.0, delta=0.01)

    def test_sparse_rain(self):
        # 雨只在头 12h 下 2mm/h，节点 7/9 00:00 → 未来24h = 24mm（24h 内前 12h 有雨）
        hourly = [2.0] * 12 + [0.0] * 108
        grid = make_precip_grid([(27.0, 118.0, hourly)])
        fut = build_future24_matrix(grid, ["2026-07-09 00:00:00"], np.array([0]))
        self.assertAlmostEqual(float(fut[0, 0]), 24.0, delta=0.01)

    def test_two_villages(self):
        hourly_a = [3.0] * 120
        hourly_b = [0.5] * 120
        grid = make_precip_grid([(27.0, 118.0, hourly_a), (28.0, 119.0, hourly_b)])
        fut = build_future24_matrix(grid, ["2026-07-09 00:00:00"], np.array([0, 1]))
        self.assertEqual(fut.shape, (2, 1))
        self.assertAlmostEqual(float(fut[0, 0]), 72.0, delta=0.01)
        self.assertAlmostEqual(float(fut[1, 0]), 12.0, delta=0.01)


class TestWarnings(unittest.TestCase):
    def test_tiers(self):
        # 未来24h 值直接驱动档位
        fut = np.array([[169.0], [170.0], [175.0], [180.0], [50.0]])
        res = compute_warnings(fut)
        self.assertEqual(res["raw"][:, 0].tolist(), [0, 1, 2, 3, 0])

    def test_hysteresis_in_matrix(self):
        # 单村序列：3,2,2,2 → 滞回 [3,3,2,2]（连续 2 个低于 3 档后降级）
        fut = np.array([[200.0, 170.0, 170.0, 170.0]])
        res = compute_warnings(fut)
        self.assertEqual(res["hysteresis"][0].tolist(), [3, 3, 2, 2])

    def test_ever_tier(self):
        raw = np.array([[3, 1], [2, 0], [0, 0], [1, 1]])
        ec = ever_tier_counts(raw)
        self.assertEqual(ec, {"high": 1, "mid": 1, "low": 1, "none": 1})


class TestWarningsJson(unittest.TestCase):
    def test_only_ever_warned(self):
        # 3 村：村0 高→低（曾预警）；村1 始终 0；村2 中
        hy = np.array([[3, 1, 0], [0, 0, 0], [2, 0, 0]], dtype=np.int8)
        villages = [{"code": "A", "name": "甲", "lon": 1.0, "lat": 2.0},
                    {"code": "B", "name": "乙", "lon": 3.0, "lat": 4.0},
                    {"code": "C", "name": "丙", "lon": 5.0, "lat": 6.0}]
        node_times = ["t0", "t1", "t2"]
        out = build_warnings_json(villages, node_times, hy)
        self.assertEqual(len(out["villages"]), 2)  # A、C 进表，B 不在
        self.assertEqual(out["nodes"][0]["w"], [[0, 3], [1, 2]])  # 村0=高, 村2=中
        self.assertEqual(out["nodes"][1]["w"], [[0, 1]])  # 村0 降到低
        self.assertEqual(out["nodes"][2]["w"], [])  # 都解除
        self.assertEqual(out["nodeTimes"], node_times)


class TestBaviDemoScenario(unittest.TestCase):
    def test_uses_eighteen_migrating_nodes_with_a_six_hundred_village_ceiling(self):
        villages = [
            {"code": f"V{i:04d}", "centerLon": 120.2 + (i % 35) * 0.06,
             "centerLat": 27.4 + (i // 35) * 0.06}
            for i in range(700)
        ]
        node_times = [f"n{i}" for i in range(71)]

        levels = build_bavi_demo_levels(villages, node_times)
        mid_high = (levels >= 2).sum(axis=0)
        active = np.nonzero(mid_high)[0].tolist()
        signatures = {tuple(levels[:, i].tolist()) for i in active}

        self.assertEqual(active, list(range(25, 43)))
        self.assertLessEqual(int(mid_high.max()), 600)
        self.assertGreaterEqual(len(signatures), 12)
        self.assertLessEqual(max(sum(1 for _ in group) for _, group in __import__("itertools").groupby(
            tuple(levels[:, i].tobytes() for i in active))), 2)
        self.assertGreater(int((levels[:, 25] > 0).sum()), 0)
        self.assertGreater(int((levels[:, 42] > 0).sum()), 0)


class TestCalibrationReport(unittest.TestCase):
    def test_peak_and_ever(self):
        raw = np.array([[3, 1, 0], [0, 2, 1], [1, 0, 0]], dtype=np.int8)
        fut = np.array([[190.0, 140.0, 0.0], [0.0, 165.0, 131.0], [131.0, 0.0, 0.0]])
        node_times = ["n0", "n1", "n2"]
        rep = calibration_report(raw, fut, node_times)
        self.assertEqual(rep["nodeCount"], 3)
        self.assertEqual(rep["peakVillageTotal"], 2)  # n0: 村0 高 + 村2 低 = 2 村
        self.assertEqual(rep["peakHi"], 1)
        self.assertEqual(rep["nodesWithWarning"], 3)
        self.assertAlmostEqual(rep["future24MaxMm"], 190.0)


if __name__ == "__main__":
    unittest.main()

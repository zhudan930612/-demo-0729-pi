# -*- coding: utf-8 -*-
"""scripts/disaster_common.py 的单元测试（纯逻辑，无网络）。"""

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from disaster_common import (  # noqa: E402
    THRESHOLDS,
    apply_hysteresis,
    norm_village_name,
    point_in_ring,
    stable_seed,
    tier_for_mm,
)


def square(minx, miny, size=1.0):
    return [[minx, miny], [minx + size, miny], [minx + size, miny + size], [minx, miny + size], [minx, miny]]


class TestStableSeed(unittest.TestCase):
    def test_deterministic(self):
        self.assertEqual(stable_seed("a", "b"), stable_seed("a", "b"))
        self.assertNotEqual(stable_seed("a", "b"), stable_seed("a", "c"))
        self.assertNotEqual(stable_seed("a"), stable_seed("b"))

    def test_range(self):
        self.assertTrue(0 <= stable_seed("x") < 2 ** 64)


class TestTier(unittest.TestCase):
    def test_thresholds(self):
        self.assertEqual(THRESHOLDS, {"low": 130.0, "mid": 160.0, "high": 185.0})

    def test_boundaries(self):
        self.assertEqual(tier_for_mm(0.0), 0)
        self.assertEqual(tier_for_mm(129.9), 0)
        self.assertEqual(tier_for_mm(130.0), 1)
        self.assertEqual(tier_for_mm(159.9), 1)
        self.assertEqual(tier_for_mm(160.0), 2)
        self.assertEqual(tier_for_mm(184.9), 2)
        self.assertEqual(tier_for_mm(185.0), 3)
        self.assertEqual(tier_for_mm(999.0), 3)

    def test_nan(self):
        self.assertEqual(tier_for_mm(float("nan")), 0)
        self.assertEqual(tier_for_mm(float("inf")), 0)


class TestHysteresis(unittest.TestCase):
    """R3-21：升级立即生效；降级需连续 2 节点低于当前档阈值；每次只降一级。"""

    def test_upgrade_immediate(self):
        seq = [0, 1, 3, 3, 2]
        out = apply_hysteresis(seq, 2)
        # 0->1 立即；1->3 立即；3 保持；降到 2 需连续 2 节点低于 3 档阈值 → 第 5 节点才生效
        self.assertEqual(out, [0, 1, 3, 3, 3])

    def test_downgrade_requires_two_consecutive(self):
        seq = [3, 3, 3, 2, 2]
        out = apply_hysteresis(seq, 2)
        # 2 比 3 低一档：连续 2 个 2 → 第 4 节点降到 2
        self.assertEqual(out, [3, 3, 3, 3, 2])

    def test_one_level_at_a_time(self):
        seq = [3, 3, 3, 0, 0]
        out = apply_hysteresis(seq, 2)
        # 连续 2 个 0 只降一级（3->2），不会直接到 0
        self.assertEqual(out, [3, 3, 3, 3, 2])

    def test_flap_suppressed(self):
        # 阈值边界波动：单个 1 不触发降级；连续 2 个 1 才降；回 2 立即升级
        seq = [2, 1, 1, 2]
        out = apply_hysteresis(seq, 2)
        self.assertEqual(out, [2, 2, 1, 2])

    def test_flap_long_alternation(self):
        # 2 与 1 交替出现、从未连续两个 1 → 全程不降级
        seq = [2, 1, 2, 1, 2, 1, 2]
        self.assertEqual(apply_hysteresis(seq, 2), [2, 2, 2, 2, 2, 2, 2])

    def test_hold_when_equal(self):
        self.assertEqual(apply_hysteresis([1, 1, 1], 2), [1, 1, 1])

    def test_custom_hysteresis_n(self):
        seq = [3, 2, 2, 2]
        # n=3 需要连续 3 个低于阈值才降（第 4 节点生效）
        self.assertEqual(apply_hysteresis(seq, 3), [3, 3, 3, 2])


class TestNormName(unittest.TestCase):
    def test_strip_suffix(self):
        self.assertEqual(norm_village_name("五堡村"), "五堡")
        self.assertEqual(norm_village_name("新塘社区"), "新塘")
        self.assertEqual(norm_village_name("屋基里社区"), "屋基里")
        self.assertEqual(norm_village_name("彭埠镇1"), "彭埠镇1")

    def test_strip_whitespace(self):
        self.assertEqual(norm_village_name("五 堡 村"), "五堡")

    def test_short_names_keep(self):
        self.assertEqual(norm_village_name("村"), "村")  # 长度 ≤2 不剥
        self.assertEqual(norm_village_name("一组"), "一组")


class TestPointInRing(unittest.TestCase):
    def test_inside(self):
        self.assertTrue(point_in_ring(0.5, 0.5, square(0, 0)))
        self.assertTrue(point_in_ring(0.0, 0.0, square(0, 0)))

    def test_outside(self):
        self.assertFalse(point_in_ring(2.0, 2.0, square(0, 0)))
        self.assertFalse(point_in_ring(-1.0, 0.5, square(0, 0)))

    def test_hole_ignored(self):
        # 只测外环：内环由调用方保证只传外环
        ring = square(0, 0, 10.0)
        self.assertTrue(point_in_ring(1.0, 1.0, ring))


if __name__ == "__main__":
    unittest.main()

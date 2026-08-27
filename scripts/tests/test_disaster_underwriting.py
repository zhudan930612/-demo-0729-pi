# -*- coding: utf-8 -*-
"""scripts/generate-disaster-underwriting.py 的单元测试（纯逻辑 + 确定性，无网络）。"""

import json
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("generate_disaster_underwriting", SCRIPTS / "generate-disaster-underwriting.py")
_gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gen)
SUM_INSURED_PER_MU = _gen.SUM_INSURED_PER_MU
TARGET_TOTAL_MU = _gen.TARGET_TOTAL_MU
mock_draw = _gen.mock_draw
summarize_real_policy = _gen.summarize_real_policy


class TestMockDraw(unittest.TestCase):
    def test_deterministic(self):
        a = mock_draw("330000000001", "村A")
        b = mock_draw("330000000001", "村A")
        self.assertEqual(a, b)
        c = mock_draw("330000000002", "村B")
        self.assertNotEqual(a["areaRaw"], c["areaRaw"])

    def test_positive(self):
        d = mock_draw("330000000003", "村C")
        self.assertGreater(d["areaRaw"], 0)
        self.assertGreaterEqual(d["hhRaw"], 1)


class TestRealPolicy(unittest.TestCase):
    def test_real_summary(self):
        # 龙江村 330604102014 → policy-v1.json 实测 2882.7 亩 / 305 户
        summary = summarize_real_policy("330604102014")
        self.assertIsNotNone(summary)
        self.assertGreater(summary["insuredAreaMu"], 2000)
        self.assertGreater(summary["householdCount"], 100)

    def test_missing_policy_none(self):
        self.assertIsNone(summarize_real_policy("000000000000"))


class TestConstants(unittest.TestCase):
    def test_scale_anchor(self):
        # 契约 6.5：总量 1100~1300 万亩、保额 1250 元/亩
        self.assertTrue(11_000_000 <= TARGET_TOTAL_MU <= 13_000_000)
        self.assertEqual(SUM_INSURED_PER_MU, 1250)


if __name__ == "__main__":
    unittest.main()

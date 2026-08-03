# -*- coding: utf-8 -*-

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
SCRIPT = SCRIPTS / "prepare-boundaries.py"
SPEC = importlib.util.spec_from_file_location("prepare_boundaries", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PrepareBoundariesTest(unittest.TestCase):
    def test_village_level_code_excludes_township_self_records(self):
        self.assertTrue(MODULE.is_village_level_code("330182108264"))
        self.assertTrue(MODULE.is_village_level_code("330182003206"))
        self.assertFalse(MODULE.is_village_level_code("330102001000"))
        self.assertFalse(MODULE.is_village_level_code("330102001"))
        self.assertFalse(MODULE.is_village_level_code("330102001ABC"))


if __name__ == "__main__":
    unittest.main()

# -*- coding: utf-8 -*-
"""prepare-parcel-pilot.py 多村参数化单测：村定位、目录派生与向后兼容。"""

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
SCRIPT = SCRIPTS / "prepare-parcel-pilot.py"
SPEC = importlib.util.spec_from_file_location("prepare_parcel_pilot", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PrepareParcelPilotTest(unittest.TestCase):
    def test_batch_dir_name_preserves_longjiang_legacy(self):
        # 龙江村必须保留历史英文目录名 Longjiang（既有模型产物与 batch 配置引用它）
        self.assertEqual(MODULE.batch_dir_name("330604102014"), "Longjiang")

    def test_batch_dir_name_uses_code_for_other_villages(self):
        # 其余村统一使用村代码目录名，避免中文路径
        self.assertEqual(MODULE.batch_dir_name("330604102016"), "330604102016")
        self.assertEqual(MODULE.batch_dir_name("330683104307"), "330683104307")

    def test_village_name_resolved_from_villages_files(self):
        # 章镇镇（村码前缀 != 乡镇码）与三界镇（跨县）均可反查村名
        self.assertEqual(MODULE.village_name("330604102016"), "清潭村")
        self.assertEqual(MODULE.village_name("330683104307"), "临虞村")

    def test_find_village_rejects_unknown_code(self):
        with self.assertRaises(SystemExit):
            MODULE.find_village("999999999999")

    def test_paths_derive_frontend_by_code(self):
        _, _, _, _, frontend = MODULE.paths_for("330604102016")
        self.assertEqual(frontend.name, "330604102016.geojson")
        self.assertIn("parcels", str(frontend))
        work, input_dir, _, _, _ = MODULE.paths_for("330604102016")
        self.assertEqual(input_dir.name, "330604102016")
        self.assertTrue(str(work).endswith("330604102016"))


if __name__ == "__main__":
    unittest.main()

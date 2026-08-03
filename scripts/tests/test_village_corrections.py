# -*- coding: utf-8 -*-

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from village_corrections import (  # noqa: E402
    VillageCorrectionError,
    load_verified_village_corrections,
)


class VillageCorrectionsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "source.shp"
        self.identity = self.root / "identity.shp"
        for base, prefix in ((self.source, b"source"), (self.identity, b"identity")):
            for suffix in (".shp", ".shx", ".dbf", ".prj"):
                base.with_suffix(suffix).write_bytes(prefix + suffix.encode())
        self.config = self.root / "corrections.json"
        self.write_config()

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def signatures(path):
        result = {}
        for suffix in (".shp", ".shx", ".dbf", ".prj"):
            data = path.with_suffix(suffix).read_bytes()
            result[suffix] = {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        return result

    def write_config(self):
        self.config.write_text(json.dumps({
            "schemaVersion": 1,
            "dataset": {"path": "source.shp", "files": self.signatures(self.source)},
            "identityDataset": {
                "path": "identity.shp",
                "objectIdField": "objectid",
                "files": self.signatures(self.identity),
            },
            "corrections": [{
                "objectId": "42",
                "recordIndex": 7,
                "action": "recode",
                "expected": {
                    "townshipCode": "old-town",
                    "townshipName": "旧乡",
                    "villageCode": "old-village",
                    "villageName": "测试村",
                },
                "replacement": {
                    "townshipCode": "new-town",
                    "townshipName": "新乡",
                    "villageCode": "new-village",
                    "villageName": "测试村",
                },
                "reason": "测试审计规则",
                "sources": [{
                    "url": "https://example.test/source", "publisher": "测试发布主体",
                    "accessed": "2026-08-03", "reason": "测试规则来源",
                }],
            }],
        }, ensure_ascii=False), encoding="utf-8")

    def test_exact_record_is_replaced_and_completion_is_verified(self):
        source, identity, corrections = load_verified_village_corrections(self.root, self.config)
        self.assertEqual(source, self.source.resolve())
        self.assertEqual(identity, self.identity.resolve())
        unchanged = corrections.apply(6, "not-target", {
            "townshipCode": "x", "townshipName": "x", "villageCode": "x", "villageName": "x",
        })
        self.assertEqual(unchanged["villageCode"], "x")
        corrected = corrections.apply(7, "42", {
            "townshipCode": "old-town", "townshipName": "旧乡",
            "villageCode": "old-village", "villageName": "测试村",
        })
        self.assertEqual(corrected, {
            "townshipCode": "new-town", "townshipName": "新乡",
            "villageCode": "new-village", "villageName": "测试村",
        })
        corrections.verify_complete()

    def test_source_signature_drift_fails_closed(self):
        self.source.with_suffix(".dbf").write_bytes(b"changed")
        with self.assertRaisesRegex(VillageCorrectionError, "文件签名漂移"):
            load_verified_village_corrections(self.root, self.config)

    def test_object_id_or_old_values_drift_fails_closed(self):
        _, _, corrections = load_verified_village_corrections(self.root, self.config)
        with self.assertRaisesRegex(VillageCorrectionError, "目标记录漂移"):
            corrections.apply(7, "unexpected", {
                "townshipCode": "old-town", "townshipName": "旧乡",
                "villageCode": "old-village", "villageName": "测试村",
            })

    def test_missing_target_fails_closed(self):
        _, _, corrections = load_verified_village_corrections(self.root, self.config)
        with self.assertRaisesRegex(VillageCorrectionError, "未命中全部目标记录"):
            corrections.verify_complete()


if __name__ == "__main__":
    unittest.main()

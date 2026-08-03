# -*- coding: utf-8 -*-

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from township_corrections import (  # noqa: E402
    TownshipCorrectionError,
    load_township_corrections_for_zip,
)


class TownshipCorrectionsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.zip_path = self.root / "source.zip"
        self.zip_path.write_bytes(b"zip fixture")
        self.member = "townships.geojson"
        self.raw = b'{"fixture":true}'
        self.config = self.root / "corrections.json"
        self.config.write_text(json.dumps({
            "schemaVersion": 1,
            "dataset": {
                "path": "source.zip",
                "size": self.zip_path.stat().st_size,
                "sha256": hashlib.sha256(self.zip_path.read_bytes()).hexdigest(),
                "member": self.member,
                "memberSize": len(self.raw),
                "memberSha256": hashlib.sha256(self.raw).hexdigest(),
            },
            "corrections": [{
                "featureIndex": 2,
                "featureId": "99",
                "action": "drop",
                "expected": {"code": "duplicate", "name": "错误乡"},
                "reason": "测试",
                "sources": [{"url": "https://example.test"}],
            }],
        }, ensure_ascii=False), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def load(self):
        return load_township_corrections_for_zip(
            self.root, self.zip_path, self.member, self.raw, self.config)

    def test_exact_feature_is_dropped(self):
        corrections = self.load()
        self.assertIsNotNone(corrections)
        self.assertIsNone(corrections.apply(2, {
            "properties": {"id": 99, "code": "duplicate", "name": "错误乡"},
        }))
        corrections.verify_complete()

    def test_non_target_zip_is_not_modified(self):
        other = self.root / "other.zip"
        other.write_bytes(b"other")
        self.assertIsNone(load_township_corrections_for_zip(
            self.root, other, self.member, self.raw, self.config))

    def test_signature_or_target_drift_fails_closed(self):
        with self.assertRaisesRegex(TownshipCorrectionError, "签名漂移"):
            load_township_corrections_for_zip(
                self.root, self.zip_path, self.member, b"changed", self.config)
        corrections = self.load()
        with self.assertRaisesRegex(TownshipCorrectionError, "目标漂移"):
            corrections.apply(2, {
                "properties": {"id": 99, "code": "changed", "name": "错误乡"},
            })

    def test_missing_target_fails_closed(self):
        with self.assertRaisesRegex(TownshipCorrectionError, "未命中全部目标"):
            self.load().verify_complete()


if __name__ == "__main__":
    unittest.main()

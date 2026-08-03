# -*- coding: utf-8 -*-
"""严格加载和应用四级边界中的乡镇要素修正规则。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


class TownshipCorrectionError(ValueError):
    """乡镇修正规则或源数据偏离审计基线。"""


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class TownshipCorrections:
    def __init__(self, rules: list[dict[str, Any]]):
        self._by_index = {}
        self._applied = set()
        for rule in rules:
            index = rule.get("featureIndex")
            if (
                not isinstance(index, int)
                or index < 0
                or index in self._by_index
                or not str(rule.get("featureId", "")).strip()
                or rule.get("action") != "drop"
                or not isinstance(rule.get("expected"), dict)
                or not rule.get("reason")
                or not rule.get("sources")
            ):
                raise TownshipCorrectionError(f"乡镇修正规则结构无效：{index}")
            self._by_index[index] = rule

    def apply(self, index: int, feature: dict[str, Any]) -> dict[str, Any] | None:
        rule = self._by_index.get(index)
        if rule is None:
            return feature
        properties = feature.get("properties", {})
        actual = {"code": str(properties.get("code", "")).strip(), "name": str(properties.get("name", "")).strip()}
        if str(properties.get("id", "")).strip() != rule["featureId"] or actual != rule["expected"]:
            raise TownshipCorrectionError(
                f"乡镇修正规则目标漂移：featureIndex={index}, featureId={properties.get('id')}"
            )
        self._applied.add(index)
        return None

    def verify_complete(self) -> None:
        missing = sorted(set(self._by_index) - self._applied)
        if missing:
            raise TownshipCorrectionError(f"乡镇修正规则未命中全部目标：{missing}")


def load_township_corrections_for_zip(root: Path, zip_path: Path, member: str, raw: bytes, config_path: Path):
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise TownshipCorrectionError(f"无法读取乡镇修正规则：{config_path}") from exc
    if config.get("schemaVersion") != 1 or not isinstance(config.get("corrections"), list):
        raise TownshipCorrectionError("乡镇修正规则版本或 corrections 无效")
    dataset = config.get("dataset", {})
    configured_path = (Path(root) / str(dataset.get("path", ""))).resolve()
    zip_path = zip_path.resolve()
    if configured_path != zip_path:
        return None
    zip_bytes = zip_path.read_bytes()
    if (
        len(zip_bytes) != dataset.get("size")
        or _sha256_bytes(zip_bytes) != dataset.get("sha256")
        or member != dataset.get("member")
        or len(raw) != dataset.get("memberSize")
        or _sha256_bytes(raw) != dataset.get("memberSha256")
    ):
        raise TownshipCorrectionError("乡镇修正规则源 ZIP 或成员签名漂移")
    return TownshipCorrections(config["corrections"])

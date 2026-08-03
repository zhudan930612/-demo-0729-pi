# -*- coding: utf-8 -*-
"""加载并严格应用村界源数据的可审计修正规则。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from correction_schema import validate_sources


class VillageCorrectionError(ValueError):
    """修正规则、源签名或目标记录与审计基线不一致。"""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_dataset(root: Path, block: dict[str, Any], label: str) -> Path:
    relative = block.get("path")
    files = block.get("files")
    if not isinstance(relative, str) or not isinstance(files, dict) or not files:
        raise VillageCorrectionError(f"{label}签名配置无效")
    root = root.resolve()
    path = (root / relative).resolve()
    if root not in path.parents:
        raise VillageCorrectionError(f"{label}路径越出仓库")
    for suffix, expected in files.items():
        if not isinstance(suffix, str) or not isinstance(expected, dict):
            raise VillageCorrectionError(f"{label}文件签名无效")
        file_path = path.with_suffix(suffix)
        try:
            size = file_path.stat().st_size
        except OSError as exc:
            raise VillageCorrectionError(f"{label}文件缺失：{suffix}") from exc
        if size != expected.get("size") or _sha256(file_path) != expected.get("sha256"):
            raise VillageCorrectionError(f"{label}文件签名漂移：{suffix}")
    return path


class VillageCorrections:
    """按源记录序号和伴随 identity objectid 精确匹配修正规则。"""

    def __init__(self, rules: list[dict[str, Any]]):
        self._by_index: dict[int, dict[str, Any]] = {}
        self._applied: set[int] = set()
        for rule in rules:
            index = rule.get("recordIndex")
            object_id = str(rule.get("objectId", "")).strip()
            action = rule.get("action")
            expected = rule.get("expected")
            if (
                not isinstance(index, int)
                or index < 0
                or index in self._by_index
                or not object_id
                or action not in {"drop", "recode"}
                or not isinstance(expected, dict)
                or not rule.get("reason")
            ):
                raise VillageCorrectionError(f"修正规则结构无效：{object_id or index}")
            validate_sources(rule.get("sources"), f"村界修正规则 {object_id}", VillageCorrectionError)
            if action == "recode" and not isinstance(rule.get("replacement"), dict):
                raise VillageCorrectionError(f"recode 缺少 replacement：{object_id}")
            self._by_index[index] = rule

    def apply(self, index: int, object_id: str, record: dict[str, str]) -> dict[str, str] | None:
        rule = self._by_index.get(index)
        if rule is None:
            return record
        expected = rule["expected"]
        actual = {
            "townshipCode": record["townshipCode"],
            "townshipName": record["townshipName"],
            "villageCode": record["villageCode"],
            "villageName": record["villageName"],
        }
        if str(object_id).strip() != rule["objectId"] or actual != expected:
            raise VillageCorrectionError(
                f"修正规则目标记录漂移：recordIndex={index}, objectId={object_id}"
            )
        self._applied.add(index)
        if rule["action"] == "drop":
            return None
        replacement = rule["replacement"]
        return {
            "townshipCode": str(replacement["townshipCode"]),
            "townshipName": str(replacement["townshipName"]),
            "villageCode": str(replacement["villageCode"]),
            "villageName": str(replacement["villageName"]),
        }

    def verify_complete(self) -> None:
        missing = sorted(set(self._by_index) - self._applied)
        if missing:
            raise VillageCorrectionError(f"修正规则未命中全部目标记录：{missing}")


def load_verified_village_corrections(root: Path, config_path: Path) -> tuple[Path, Path, VillageCorrections]:
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise VillageCorrectionError(f"无法读取村界修正规则：{config_path}") from exc
    if config.get("schemaVersion") != 1 or not isinstance(config.get("corrections"), list):
        raise VillageCorrectionError("村界修正规则版本或 corrections 无效")
    source_path = _verify_dataset(Path(root), config.get("dataset", {}), "修正源数据")
    identity_dataset = config.get("identityDataset", {})
    if identity_dataset.get("objectIdField") != "objectid":
        raise VillageCorrectionError("修正 identity 数据的 objectIdField 无效")
    identity_path = _verify_dataset(Path(root), identity_dataset, "修正 identity 数据")
    return source_path, identity_path, VillageCorrections(config["corrections"])

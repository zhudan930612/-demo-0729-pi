# -*- coding: utf-8 -*-
"""
政府驻地坐标表校验：server/data/government-seats-v1.json vs 天气空间索引

校验内容：
  1. 表结构：schemaVersion / provinceCode / entries 列表
  2. 每条记录与 weather/index-v2.json 的 code / name / level 一一匹配
  3. 候选记录评分门槛：省/市/县 >= 99，乡镇 >= 60；坐标必须为有限数值对
  4. 每个候选驻地必须位于自身行政面、完整父级链与浙江省界共同范围内
  5. 统计省 -> 市 -> 县 -> 乡镇子级总量与最大单县乡镇数（碰撞验收基线）

只输出统计与失败代码，不输出坐标明细。返回码 0 表示通过。
"""
from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any

from shapely.geometry import Point, shape

SCORE_THRESHOLDS = {"province": 99, "city": 99, "county": 99, "township": 60}
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SEATS_FILE = ROOT / "server" / "data" / "government-seats-v1.json"
DEFAULT_DATA_DIR = ROOT / ".dev-runtime" / "weather-data"


class GovernmentSeatsError(ValueError):
    pass


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise GovernmentSeatsError(f"无法读取 JSON：{path}") from exc
    if not isinstance(value, dict):
        raise GovernmentSeatsError(f"JSON 根节点必须是对象：{path}")
    return value


def _safe_data_path(data_dir: Path, relative_path: str) -> Path:
    posix_path = PurePosixPath(relative_path)
    if posix_path.is_absolute() or ".." in posix_path.parts:
        raise GovernmentSeatsError(f"边界引用不是安全相对路径：{relative_path}")
    root = data_dir.resolve()
    result = (root / Path(*posix_path.parts)).resolve()
    if result != root and root not in result.parents:
        raise GovernmentSeatsError(f"边界引用越出数据目录：{relative_path}")
    return result


def _trusted_geometry(feature: dict[str, Any], reference: str):
    try:
        geometry = shape(feature.get("geometry"))
    except Exception as exc:
        raise GovernmentSeatsError(f"边界几何无法解析：{reference}") from exc
    if geometry.geom_type not in {"Polygon", "MultiPolygon"} or geometry.is_empty or not geometry.is_valid:
        raise GovernmentSeatsError(f"边界几何为空或无效：{reference}")
    return geometry


def _load_feature_map(data_dir: Path, relative_path: str) -> dict[str, dict[str, Any]]:
    collection = _read_json(_safe_data_path(data_dir, relative_path))
    if collection.get("type") != "FeatureCollection" or not isinstance(collection.get("features"), list):
        raise GovernmentSeatsError(f"边界文件不是 FeatureCollection：{relative_path}")
    result: dict[str, dict[str, Any]] = {}
    for feature in collection["features"]:
        if not isinstance(feature, dict) or feature.get("type") != "Feature" or not isinstance(feature.get("properties"), dict):
            raise GovernmentSeatsError(f"边界文件包含无效 Feature：{relative_path}")
        code = str(feature["properties"].get("code", "")).strip()
        if not code or code in result:
            raise GovernmentSeatsError(f"边界文件包含空或重复代码：{relative_path}")
        _trusted_geometry(feature, f"{relative_path}#{code}")
        result[code] = feature
    return result


def load_index(data_dir: Path) -> dict[str, dict[str, Any]]:
    """读取天气空间索引，返回 {code: {code,name,level,parentCode,boundaryPath}}。"""
    index = _read_json(data_dir / "weather" / "index-v2.json")
    if index.get("schemaVersion") != 2 or index.get("provinceCode") != "330000":
        raise GovernmentSeatsError("天气空间索引版本无效")
    nodes = index.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        raise GovernmentSeatsError("天气空间索引没有节点")
    result: dict[str, dict[str, Any]] = {}
    for node in nodes:
        code = str(node.get("code", "")).strip() if isinstance(node, dict) else ""
        boundary = node.get("boundary") if isinstance(node, dict) else None
        # 政府驻地表只覆盖省/市/县/乡镇；村节点（village）不在表内，跳过。
        if not code or code in result or not str(node.get("name", "")).strip():
            raise GovernmentSeatsError(f"天气空间索引节点无效：{code}")
        if node.get("level") not in SCORE_THRESHOLDS:
            continue
        if not isinstance(boundary, dict) or boundary.get("featureCode") != code or not str(boundary.get("path", "")).strip():
            raise GovernmentSeatsError(f"天气空间索引边界引用无效：{code}")
        result[code] = {
            "code": code,
            "name": str(node["name"]).strip(),
            "level": node["level"],
            "parentCode": node.get("parentCode"),
            "boundaryPath": str(boundary["path"]).strip(),
        }
    return result


def validate_seats(seats_file: Path, data_dir: Path) -> dict[str, Any]:
    seats = _read_json(seats_file)
    if seats.get("schemaVersion") != 1 or seats.get("provinceCode") != "330000":
        raise GovernmentSeatsError("政府驻地坐标表结构无效")
    entries = seats.get("entries")
    if not isinstance(entries, list) or not entries:
        raise GovernmentSeatsError("政府驻地坐标表没有条目")

    index = load_index(data_dir)
    by_code: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise GovernmentSeatsError("政府驻地坐标表包含非对象条目")
        code = str(entry.get("code", "")).strip()
        if not code or code in by_code:
            raise GovernmentSeatsError(f"政府驻地坐标表代码缺失或重复：{code}")
        by_code[code] = entry

    # 结构一致性：与索引逐条匹配
    unmatched_codes = sorted(set(by_code) - set(index))
    missing_in_table = sorted(set(index) - set(by_code))
    # 表条目只能引用索引中存在的代码，不允许表里有索引之外的游离记录（防止注入/错配）。
    if unmatched_codes:
        raise GovernmentSeatsError(f"政府驻地表包含索引之外的代码 {len(unmatched_codes)} 条（{unmatched_codes[:10]}…）")
    if unmatched_codes or missing_in_table:
        raise GovernmentSeatsError(
            f"政府驻地表与天气索引代码集合不一致：表多 {len(unmatched_codes)} 条（{unmatched_codes[:5]}…），缺 {len(missing_in_table)} 条（{missing_in_table[:5]}…）"
        )
    for code, node in index.items():
        entry = by_code[code]
        if str(entry.get("name", "")).strip() != node["name"] or entry.get("level") != node["level"]:
            raise GovernmentSeatsError(f"政府驻地记录与索引名称/层级冲突：{code}")

    # 逐条候选校验 + 边界校验
    status_counter: Counter[str] = Counter()
    level_counter: Counter[str] = Counter()
    failures: list[str] = []
    excluded: list[str] = []
    usable_by_level: Counter[str] = Counter()
    geometries: dict[str, Any] = {}
    feature_cache: dict[str, dict[str, dict[str, Any]]] = {}

    def features(path: str):
        if path not in feature_cache:
            feature_cache[path] = _load_feature_map(data_dir, path)
        return feature_cache[path]

    for code, node in sorted(index.items()):
        entry = by_code[code]
        status = str(entry.get("status", "")).strip()
        status_counter[status] += 1
        level_counter[str(entry.get("level", "")).strip()] += 1
        if status == "unresolved":
            continue
        if status != "candidate":
            failures.append(f"{code} 状态无效：{status}")
            continue
        threshold = SCORE_THRESHOLDS[node["level"]]
        score = entry.get("score")
        point = entry.get("point")
        if not isinstance(point, list) or len(point) != 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in point):
            failures.append(f"{code} 候选坐标不是有限数值对")
            continue
        if not isinstance(score, (int, float)) or not math.isfinite(score) or score < threshold:
            failures.append(f"{code} 评分 {score} 低于 {node['level']} 门槛 {threshold}")
            continue
        # 边界校验：自身 + 完整父链 + 省界；越界候选运行期 fail closed 排除（不以面中心/代表点降级）
        ok, geometry = _point_in_chain(point, code, index, features)
        if not ok:
            excluded.append(code)
            continue
        usable_by_level[node["level"]] += 1
        geometries[code] = geometry

    if failures:
        raise GovernmentSeatsError(f"政府驻地校验失败 {len(failures)} 条：{failures[:20]}{'…' if len(failures) > 20 else ''}")

    # 子级统计（按索引全量）与可用子级统计（按边界校验后的驻地）
    child_count: Counter[str] = Counter()
    for code, node in index.items():
        if node["level"] != "province" and node["parentCode"] in index:
            child_count[node["parentCode"]] += 1
    usable_child_count: Counter[str] = Counter()
    for code, node in index.items():
        if node["level"] != "province" and node["parentCode"] in index and code in geometries:
            usable_child_count[node["parentCode"]] += 1
    parent_names = {code: node["name"] for code, node in index.items()}
    by_level: dict[str, list[str]] = {}
    for code, node in index.items():
        by_level.setdefault(node["level"], []).append(code)
    max_county_townships = max((count for parent, count in child_count.items() if index[parent]["level"] == "county"), default=0)
    max_county = [parent for parent, count in child_count.items() if index[parent]["level"] == "county" and count == max_county_townships]
    usable_max_county_townships = max((count for parent, count in usable_child_count.items() if index[parent]["level"] == "county"), default=0)
    usable_max_county = [parent for parent, count in usable_child_count.items() if index[parent]["level"] == "county" and count == usable_max_county_townships]

    return {
        "seatsFile": str(seats_file),
        "dataDir": str(data_dir),
        "total": len(entries),
        "byLevel": dict(level_counter),
        "byStatus": dict(status_counter),
        "candidate": status_counter["candidate"],
        "unresolved": status_counter["unresolved"],
        "scores": {
            "province": {"min": min((by_code[c]["score"] for c in by_level["province"] if by_code[c]["status"] == "candidate"), default=None)},
            "city": {"min": min((by_code[c]["score"] for c in by_level["city"] if by_code[c]["status"] == "candidate"), default=None)},
            "county": {"min": min((by_code[c]["score"] for c in by_level["county"] if by_code[c]["status"] == "candidate"), default=None)},
            "township": {"min": min((by_code[c]["score"] for c in by_level["township"] if by_code[c]["status"] == "candidate"), default=None)},
        },
        "children": {
            "citiesUnderProvince": child_count["330000"],
            "countiesUnderCities": [child_count[code] for code in by_level["city"]],
            "townshipsUnderCounties": [child_count[code] for code in by_level["county"]],
            "maxTownshipsInCounty": max_county_townships,
            "maxTownshipsCountyNames": sorted(parent_names[c] for c in max_county),
            "usableMaxTownshipsInCounty": usable_max_county_townships,
            "usableMaxTownshipsCountyNames": sorted(parent_names[c] for c in usable_max_county),
            "countyWithTownships": len([code for code in by_level["county"] if child_count[code] > 0]),
        },
        "usableByLevel": dict(usable_by_level),
        "excludedByBoundary": {
            "count": len(excluded),
            "codes": excluded,
        },
        "failures": len(failures),
    }


def _point_in_chain(point: list[float], code: str, index: dict[str, dict[str, Any]], features) -> tuple[bool, Any]:
    """驻地点必须位于自身面、完整父链与省界共同范围内。返回 (ok, 自身几何)。"""
    node = index[code]
    try:
        seat_point = Point(float(point[0]), float(point[1]))
    except (TypeError, ValueError):
        return False, None
    geometry = None
    current: dict[str, Any] | None = node
    while current is not None:
        feature_map = features(current["boundaryPath"])
        feature = feature_map.get(current["code"])
        if feature is None:
            return False, None
        geom = _trusted_geometry(feature, f'{current["boundaryPath"]}#{current["code"]}')
        if not geom.covers(seat_point):
            return False, None
        if current["code"] == code:
            geometry = geom
        parent_code = current["parentCode"]
        current = index.get(parent_code) if parent_code else None
    return geometry is not None, geometry


def main() -> int:
    parser = argparse.ArgumentParser(description="校验政府驻地坐标表与天气空间索引的一致性")
    parser.add_argument("--seats-file", type=Path, default=DEFAULT_SEATS_FILE)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    args = parser.parse_args()
    try:
        result = validate_seats(args.seats_file, args.data_dir)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        print(f"政府驻地校验通过：候选 {result['candidate']} / 未解析 {result['unresolved']} / 边界校验可用 {result['usableByLevel']} / 越界排除 {result['excludedByBoundary']['count']} 条")
        return 0
    except GovernmentSeatsError as exc:
        print(f"政府驻地校验失败：{exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

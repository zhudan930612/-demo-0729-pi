# -*- coding: utf-8 -*-
"""生成并 fail closed 校验天气服务使用的浙江五级可信空间索引。"""

from __future__ import annotations

import argparse
import json
import math
import shutil
from pathlib import Path, PurePosixPath
from typing import Any

from shapely.geometry import Point, mapping, shape

SCHEMA_VERSION = 2
INDEX_RELATIVE_PATH = Path("weather") / "index-v2.json"
LEVELS = ("province", "city", "county", "township", "village")
DEFAULT_WEB_DATA_DIR = Path(__file__).resolve().parent.parent / "web" / "public" / "data"
DEFAULT_PRIVATE_DATA_DIR = Path(__file__).resolve().parent.parent / ".dev-runtime" / "weather-data"
DEFAULT_MISSING_VILLAGES_ALLOWLIST = Path(__file__).resolve().parent / "data" / "weather-missing-villages-allowlist-v1.json"


class WeatherSpatialIndexError(ValueError):
    pass


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise WeatherSpatialIndexError(f"无法读取 JSON：{path}") from exc
    if not isinstance(value, dict):
        raise WeatherSpatialIndexError(f"JSON 根节点必须是对象：{path}")
    return value


def _safe_data_path(data_dir: Path, relative_path: str) -> Path:
    posix_path = PurePosixPath(relative_path)
    if posix_path.is_absolute() or ".." in posix_path.parts:
        raise WeatherSpatialIndexError(f"边界引用不是安全相对路径：{relative_path}")
    root = data_dir.resolve()
    result = (root / Path(*posix_path.parts)).resolve()
    if result != root and root not in result.parents:
        raise WeatherSpatialIndexError(f"边界引用越出数据目录：{relative_path}")
    return result


def _trusted_geometry(feature: dict[str, Any], reference: str):
    try:
        geometry = shape(feature.get("geometry"))
    except Exception as exc:
        raise WeatherSpatialIndexError(f"边界几何无法解析：{reference}") from exc
    if geometry.geom_type not in {"Polygon", "MultiPolygon"} or geometry.is_empty or not geometry.is_valid:
        raise WeatherSpatialIndexError(f"边界几何为空或无效：{reference}")
    return geometry


def _load_feature_map(data_dir: Path, relative_path: str) -> dict[str, dict[str, Any]]:
    collection = _read_json(_safe_data_path(data_dir, relative_path))
    if collection.get("type") != "FeatureCollection" or not isinstance(collection.get("features"), list):
        raise WeatherSpatialIndexError(f"边界文件不是 FeatureCollection：{relative_path}")
    result = {}
    for feature in collection["features"]:
        if not isinstance(feature, dict) or feature.get("type") != "Feature" or not isinstance(feature.get("properties"), dict):
            raise WeatherSpatialIndexError(f"边界文件包含无效 Feature：{relative_path}")
        code = str(feature["properties"].get("code", "")).strip()
        name = str(feature["properties"].get("name", "")).strip()
        if not code or not name or code in result:
            raise WeatherSpatialIndexError(f"边界文件包含空、重复代码或空名称：{relative_path}")
        _trusted_geometry(feature, f"{relative_path}#{code}")
        result[code] = feature
    return result


def _load_missing_allowlist(path: Path) -> dict[str, str]:
    value = _read_json(path)
    source = value.get("source", {})
    if value.get("schemaVersion") != 1 or not isinstance(value.get("sourceType"), str) or not value["sourceType"].strip():
        raise WeatherSpatialIndexError("无村界乡镇 allowlist 版本无效")
    if not all(isinstance(source.get(key), str) and source[key].strip() for key in ("url", "publisher", "accessed", "reason")):
        raise WeatherSpatialIndexError("无村界乡镇 allowlist 来源无效")
    entries = value.get("entries")
    if not isinstance(entries, list):
        raise WeatherSpatialIndexError("无村界乡镇 allowlist entries 无效")
    result = {}
    for entry in entries:
        code = str(entry.get("code", "")).strip() if isinstance(entry, dict) else ""
        name = str(entry.get("name", "")).strip() if isinstance(entry, dict) else ""
        if not code or not name or code in result or not str(entry.get("reason", "")).strip() or not str(entry.get("sourceType", "")).strip():
            raise WeatherSpatialIndexError(f"无村界乡镇 allowlist 条目无效：{code}")
        result[code] = name
    return result


def _manifest_nodes(manifest: dict[str, Any]) -> tuple[str, dict[str, dict[str, Any]]]:
    province = manifest.get("province")
    cities = manifest.get("cities")
    if not isinstance(province, dict) or not isinstance(cities, list):
        raise WeatherSpatialIndexError("manifest.json 缺少 province/cities")
    specs: dict[str, dict[str, Any]] = {}
    def add(raw, level, parent, boundary, children):
        code = str(raw.get("code", "")).strip() if isinstance(raw, dict) else ""
        name = str(raw.get("name", "")).strip() if isinstance(raw, dict) else ""
        if not code or not name or code in specs:
            raise WeatherSpatialIndexError(f"manifest 节点空、重复或名称无效：{code}")
        specs[code] = {"code": code, "name": name, "level": level, "parentCode": parent, "boundary": boundary, "children": children}
    province_code = str(province.get("code", "")).strip()
    if province_code != "330000": raise WeatherSpatialIndexError("天气索引只接受浙江省根 330000")
    city_codes = [str(x.get("code", "")).strip() for x in cities]
    add(province, "province", None, "boundary/province.geojson", city_codes)
    for city in cities:
        counties = city.get("counties") if isinstance(city, dict) else None
        if not isinstance(counties, list): raise WeatherSpatialIndexError("manifest 城市结构无效")
        city_code = str(city.get("code", "")).strip(); county_codes = [str(x.get("code", "")).strip() for x in counties]
        add(city, "city", province_code, "boundary/city/330000.geojson", county_codes)
        for county in counties:
            towns = county.get("townships") if isinstance(county, dict) else None
            if not isinstance(towns, list): raise WeatherSpatialIndexError(f"manifest 县结构无效：{city_code}")
            county_code = str(county.get("code", "")).strip(); town_codes = [str(x.get("code", "")).strip() for x in towns]
            add(county, "county", city_code, f"boundary/county/{city_code}.geojson", town_codes)
            for town in towns:
                add(town, "township", county_code, f"boundary/township/{county_code}.geojson", [])
    return province_code, specs


def build_weather_spatial_index(data_dir: Path, allowlist_path: Path = DEFAULT_MISSING_VILLAGES_ALLOWLIST) -> dict[str, Any]:
    data_dir = Path(data_dir)
    province_code, specs = _manifest_nodes(_read_json(data_dir / "manifest.json"))
    allowlist = _load_missing_allowlist(allowlist_path)
    cache = {}
    def features(path):
        if path not in cache: cache[path] = _load_feature_map(data_dir, path)
        return cache[path]
    # manifest/边界名称强一致，并建立几何。
    geometries = {}
    for code, spec in specs.items():
        feature = features(spec["boundary"]).get(code)
        if feature is None: raise WeatherSpatialIndexError(f"可信边界缺少 manifest 节点：{spec['boundary']}#{code}")
        if str(feature["properties"].get("name", "")).strip() != spec["name"]:
            raise WeatherSpatialIndexError(f"索引名与边界 name 冲突：{code}")
        geometries[code] = _trusted_geometry(feature, f"{spec['boundary']}#{code}")
    # 村文件必须精确匹配 allowlist；非 allowlist 缺失和多余 allowlist 都拒绝。
    missing_actual = {}
    for code, spec in list(specs.items()):
        if spec["level"] != "township": continue
        village_path = f"villages/{code}.geojson"
        if not (data_dir / village_path).exists():
            missing_actual[code] = spec["name"]
            continue
        village_features = features(village_path)
        spec["children"] = sorted(village_features)
        for village_code, feature in village_features.items():
            name = str(feature["properties"].get("name", "")).strip()
            if village_code in specs: raise WeatherSpatialIndexError(f"行政代码跨层重复：{village_code}")
            specs[village_code] = {"code": village_code, "name": name, "level": "village", "parentCode": code, "boundary": village_path, "children": []}
            geometries[village_code] = _trusted_geometry(feature, f"{village_path}#{village_code}")
    if missing_actual != allowlist:
        raise WeatherSpatialIndexError(f"无村界乡镇集合漂移：actual={sorted(missing_actual.items())}, allowlist={sorted(allowlist.items())}")
    province_geometry = geometries[province_code]
    nodes = []
    valid_chain = {}
    # 顺序由层级保证父链先完成。
    for level in LEVELS:
        for code in sorted(k for k, v in specs.items() if v["level"] == level):
            spec = specs[code]; geometry = geometries[code]
            if level == "province":
                chain_intersection = geometry
            else:
                parent_chain = valid_chain.get(spec["parentCode"])
                if parent_chain is None: raise WeatherSpatialIndexError(f"节点不可达浙江省根：{code}")
                if geometry.disjoint(geometries[spec["parentCode"]]):
                    raise WeatherSpatialIndexError(f"子几何与父级完全不相交：{code}->{spec['parentCode']}")
                if geometry.disjoint(province_geometry):
                    raise WeatherSpatialIndexError(f"子几何与浙江省界完全不相交：{code}")
                chain_intersection = geometry.intersection(parent_chain).intersection(province_geometry)
                if chain_intersection.is_empty:
                    raise WeatherSpatialIndexError(f"子几何与完整父链交集为空：{code}")
            point = chain_intersection.representative_point()
            if not all(math.isfinite(v) for v in (point.x, point.y)):
                raise WeatherSpatialIndexError(f"无法生成父链内代表点：{code}")
            valid_chain[code] = chain_intersection
            nodes.append({"code": code, "name": spec["name"], "level": level, "parentCode": spec["parentCode"], "childrenCodes": sorted(spec["children"]), "representativePoint": [float(point.x), float(point.y)], "boundary": {"path": spec["boundary"], "featureCode": code}})
    index = {"schemaVersion": SCHEMA_VERSION, "provinceCode": province_code, "nodes": nodes}
    _validate_tree(index)
    return index


def _validate_tree(index: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if index.get("schemaVersion") != SCHEMA_VERSION or index.get("provinceCode") != "330000": raise WeatherSpatialIndexError("天气空间索引版本无效")
    raw = index.get("nodes")
    if not isinstance(raw, list) or not raw: raise WeatherSpatialIndexError("天气空间索引没有节点")
    nodes = {}
    for node in raw:
        code = str(node.get("code", "")).strip() if isinstance(node, dict) else ""
        if not code or code in nodes or node.get("level") not in LEVELS or not str(node.get("name", "")).strip() or not isinstance(node.get("childrenCodes"), list):
            raise WeatherSpatialIndexError(f"天气空间索引节点无效：{code}")
        nodes[code] = node
    roots = [x for x in nodes.values() if x.get("parentCode") is None]
    if len(roots) != 1 or roots[0].get("code") != "330000" or roots[0].get("level") != "province": raise WeatherSpatialIndexError("必须且只能有浙江省根节点")
    for code, node in nodes.items():
        i = LEVELS.index(node["level"])
        if i:
            parent = nodes.get(node.get("parentCode"))
            if not parent or parent["level"] != LEVELS[i - 1] or code not in parent["childrenCodes"]: raise WeatherSpatialIndexError(f"父子关系无效：{code}")
        for child in node["childrenCodes"]:
            if child not in nodes or nodes[child].get("parentCode") != code: raise WeatherSpatialIndexError(f"子节点引用无效：{code}->{child}")
    visited, stack = set(), ["330000"]
    while stack:
        code = stack.pop()
        if code in visited: raise WeatherSpatialIndexError("天气空间索引存在环")
        visited.add(code); stack.extend(nodes[code]["childrenCodes"])
    if len(visited) != len(nodes): raise WeatherSpatialIndexError("天气空间索引存在根不可达节点")
    return nodes


def write_weather_spatial_index(source_data_dir: Path, output_data_dir: Path = DEFAULT_PRIVATE_DATA_DIR, allowlist_path: Path = DEFAULT_MISSING_VILLAGES_ALLOWLIST) -> Path:
    source_data_dir, output_data_dir = Path(source_data_dir), Path(output_data_dir)
    if source_data_dir.resolve() == output_data_dir.resolve(): raise WeatherSpatialIndexError("天气私有数据目录不得与前端 public data 相同")
    index = build_weather_spatial_index(source_data_dir, allowlist_path)
    shutil.rmtree(output_data_dir, ignore_errors=True)
    for relative in ("manifest.json", "boundary", "villages"):
        source = source_data_dir / relative; target = output_data_dir / relative
        if source.is_dir(): shutil.copytree(source, target)
        else: target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(source, target)
    output = output_data_dir / INDEX_RELATIVE_PATH
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    load_trusted_weather_spatial_index(output_data_dir)
    return output


def load_trusted_weather_spatial_index(data_dir: Path) -> dict[str, dict[str, Any]]:
    data_dir = Path(data_dir); index = _read_json(data_dir / INDEX_RELATIVE_PATH); nodes = _validate_tree(index)
    cache, geometries = {}, {}
    for code, node in nodes.items():
        boundary = node.get("boundary"); point = node.get("representativePoint")
        if not isinstance(boundary, dict) or not isinstance(point, list) or len(point) != 2 or boundary.get("featureCode") != code: raise WeatherSpatialIndexError(f"索引边界或代表点无效：{code}")
        path = boundary.get("path")
        if path not in cache: cache[path] = _load_feature_map(data_dir, path)
        feature = cache[path].get(code)
        if feature is None: raise WeatherSpatialIndexError(f"可信边界缺少索引节点：{path}#{code}")
        if str(feature["properties"].get("name", "")).strip() != node["name"]: raise WeatherSpatialIndexError(f"索引名与边界 name 冲突：{code}")
        geometries[code] = _trusted_geometry(feature, f"{path}#{code}")
    province = geometries["330000"]; chains = {}
    for level in LEVELS:
        for code in sorted(k for k, n in nodes.items() if n["level"] == level):
            node, geometry = nodes[code], geometries[code]
            try: point = Point(float(node["representativePoint"][0]), float(node["representativePoint"][1]))
            except (TypeError, ValueError) as exc: raise WeatherSpatialIndexError(f"代表点不是数值：{code}") from exc
            if level == "province": chain = geometry
            else:
                parent_geometry = geometries[node["parentCode"]]
                if geometry.disjoint(parent_geometry): raise WeatherSpatialIndexError(f"子几何与父级完全不相交：{code}")
                if geometry.disjoint(province): raise WeatherSpatialIndexError(f"子几何与浙江省界完全不相交：{code}")
                chain = geometry.intersection(chains[node["parentCode"]]).intersection(province)
                if chain.is_empty: raise WeatherSpatialIndexError(f"子几何与完整父链交集为空：{code}")
            if not geometry.covers(point) or not chain.covers(point) or not province.covers(point): raise WeatherSpatialIndexError(f"代表点不在自身、父链和浙江省界共同范围内：{code}")
            chains[code] = chain
    return nodes


def main() -> int:
    parser = argparse.ArgumentParser(description="生成并校验天气五级可信空间索引")
    parser.add_argument("--source-data-dir", type=Path, default=DEFAULT_WEB_DATA_DIR)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_PRIVATE_DATA_DIR)
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    try:
        if args.validate_only:
            nodes = load_trusted_weather_spatial_index(args.data_dir); print(f"天气空间索引校验通过：{len(nodes)} 个节点，父链冲突 0")
        else:
            output = write_weather_spatial_index(args.source_data_dir, args.data_dir); print(f"天气空间索引已生成并校验：{output}")
        return 0
    except WeatherSpatialIndexError as exc:
        print(f"天气空间索引失败：{exc}"); return 1


if __name__ == "__main__": raise SystemExit(main())

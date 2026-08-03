# -*- coding: utf-8 -*-
"""生成并校验天气服务使用的浙江五级可信空间索引。"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path, PurePosixPath
from typing import Any

from shapely.geometry import Point, shape

SCHEMA_VERSION = 1
INDEX_RELATIVE_PATH = Path("weather") / "index-v1.json"
LEVELS = ("province", "city", "county", "township", "village")


class WeatherSpatialIndexError(ValueError):
    """天气空间索引或其可信边界不完整、不一致。"""


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
    resolved_data = data_dir.resolve()
    resolved_path = (data_dir / Path(*posix_path.parts)).resolve()
    if resolved_path != resolved_data and resolved_data not in resolved_path.parents:
        raise WeatherSpatialIndexError(f"边界引用越出数据目录：{relative_path}")
    return resolved_path


def _load_feature_map(data_dir: Path, relative_path: str) -> dict[str, dict[str, Any]]:
    path = _safe_data_path(data_dir, relative_path)
    collection = _read_json(path)
    if collection.get("type") != "FeatureCollection" or not isinstance(collection.get("features"), list):
        raise WeatherSpatialIndexError(f"边界文件不是 FeatureCollection：{relative_path}")

    features: dict[str, dict[str, Any]] = {}
    for feature in collection["features"]:
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise WeatherSpatialIndexError(f"边界文件包含无效 Feature：{relative_path}")
        properties = feature.get("properties")
        code = str(properties.get("code", "")).strip() if isinstance(properties, dict) else ""
        if not code or code in features:
            raise WeatherSpatialIndexError(f"边界文件包含空或重复行政代码：{relative_path}")
        features[code] = feature
    return features


def _trusted_geometry(feature: dict[str, Any], reference: str):
    try:
        geometry = shape(feature.get("geometry"))
    except Exception as exc:
        raise WeatherSpatialIndexError(f"边界几何无法解析：{reference}") from exc
    if geometry.geom_type not in {"Polygon", "MultiPolygon"}:
        raise WeatherSpatialIndexError(f"边界几何必须是面：{reference}")
    if geometry.is_empty or not geometry.is_valid:
        raise WeatherSpatialIndexError(f"边界几何为空或无效：{reference}")
    return geometry


def _representative_point(geometry, reference: str) -> list[float]:
    point = geometry.representative_point()
    lon, lat = float(point.x), float(point.y)
    if not math.isfinite(lon) or not math.isfinite(lat) or not geometry.covers(Point(lon, lat)):
        raise WeatherSpatialIndexError(f"无法生成面内代表点：{reference}")
    return [lon, lat]


def _node(
    *, code: str, name: str, level: str, parent_code: str | None,
    children_codes: list[str], boundary_path: str, feature: dict[str, Any],
) -> dict[str, Any]:
    reference = f"{boundary_path}#{code}"
    geometry = _trusted_geometry(feature, reference)
    return {
        "code": code,
        "name": name,
        "level": level,
        "parentCode": parent_code,
        "childrenCodes": children_codes,
        "representativePoint": _representative_point(geometry, reference),
        "boundary": {"path": boundary_path, "featureCode": code},
    }


def build_weather_spatial_index(data_dir: Path) -> dict[str, Any]:
    """从 prepare-boundaries.py 的最终 GeoJSON 产物构建完整五级索引。"""
    data_dir = Path(data_dir)
    manifest = _read_json(data_dir / "manifest.json")
    province = manifest.get("province")
    cities = manifest.get("cities")
    if not isinstance(province, dict) or not isinstance(cities, list):
        raise WeatherSpatialIndexError("manifest.json 缺少 province/cities")

    province_code = str(province.get("code", "")).strip()
    if province_code != "330000":
        raise WeatherSpatialIndexError("天气空间索引只接受浙江省根节点 330000")

    feature_cache: dict[str, dict[str, dict[str, Any]]] = {}

    def features(path: str) -> dict[str, dict[str, Any]]:
        if path not in feature_cache:
            feature_cache[path] = _load_feature_map(data_dir, path)
        return feature_cache[path]

    nodes: list[dict[str, Any]] = []
    province_path = "boundary/province.geojson"
    city_path = "boundary/city/330000.geojson"
    city_codes = [str(city.get("code", "")).strip() for city in cities if isinstance(city, dict)]
    province_feature = features(province_path).get(province_code)
    if province_feature is None:
        raise WeatherSpatialIndexError("省界文件缺少 330000")
    nodes.append(_node(
        code=province_code, name=str(province.get("name", "")).strip(), level="province",
        parent_code=None, children_codes=city_codes, boundary_path=province_path,
        feature=province_feature,
    ))

    for city in cities:
        if not isinstance(city, dict) or not isinstance(city.get("counties"), list):
            raise WeatherSpatialIndexError("manifest 城市节点结构无效")
        city_code = str(city.get("code", "")).strip()
        counties = city["counties"]
        county_codes = [str(county.get("code", "")).strip() for county in counties if isinstance(county, dict)]
        city_feature = features(city_path).get(city_code)
        if city_feature is None:
            raise WeatherSpatialIndexError(f"市界文件缺少 {city_code}")
        nodes.append(_node(
            code=city_code, name=str(city.get("name", "")).strip(), level="city",
            parent_code=province_code, children_codes=county_codes, boundary_path=city_path,
            feature=city_feature,
        ))

        county_path = f"boundary/county/{city_code}.geojson"
        for county in counties:
            if not isinstance(county, dict) or not isinstance(county.get("townships"), list):
                raise WeatherSpatialIndexError(f"manifest 县节点结构无效：{city_code}")
            county_code = str(county.get("code", "")).strip()
            townships = county["townships"]
            township_codes = [str(town.get("code", "")).strip() for town in townships if isinstance(town, dict)]
            county_feature = features(county_path).get(county_code)
            if county_feature is None:
                raise WeatherSpatialIndexError(f"县界文件缺少 {county_code}")
            nodes.append(_node(
                code=county_code, name=str(county.get("name", "")).strip(), level="county",
                parent_code=city_code, children_codes=township_codes, boundary_path=county_path,
                feature=county_feature,
            ))

            township_path = f"boundary/township/{county_code}.geojson"
            for township in townships:
                if not isinstance(township, dict):
                    raise WeatherSpatialIndexError(f"manifest 乡节点结构无效：{county_code}")
                township_code = str(township.get("code", "")).strip()
                village_path = f"villages/{township_code}.geojson"
                village_file = data_dir / village_path
                village_features = features(village_path) if village_file.exists() else {}
                village_codes = sorted(village_features)
                township_feature = features(township_path).get(township_code)
                if township_feature is None:
                    raise WeatherSpatialIndexError(f"乡界文件缺少 {township_code}")
                nodes.append(_node(
                    code=township_code, name=str(township.get("name", "")).strip(), level="township",
                    parent_code=county_code, children_codes=village_codes, boundary_path=township_path,
                    feature=township_feature,
                ))
                for village_code in village_codes:
                    village_feature = village_features[village_code]
                    properties = village_feature["properties"]
                    nodes.append(_node(
                        code=village_code, name=str(properties.get("name", "")).strip(), level="village",
                        parent_code=township_code, children_codes=[], boundary_path=village_path,
                        feature=village_feature,
                    ))

    index = {
        "schemaVersion": SCHEMA_VERSION,
        "provinceCode": province_code,
        "nodes": nodes,
    }
    _validate_tree(index)
    return index


def write_weather_spatial_index(data_dir: Path) -> Path:
    data_dir = Path(data_dir)
    index = build_weather_spatial_index(data_dir)
    output = data_dir / INDEX_RELATIVE_PATH
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    # 重读序列化结果，避免浮点序列化后代表点逸出边界。
    load_trusted_weather_spatial_index(data_dir)
    return output


def _validate_tree(index: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if index.get("schemaVersion") != SCHEMA_VERSION or index.get("provinceCode") != "330000":
        raise WeatherSpatialIndexError("天气空间索引版本或省级根代码无效")
    raw_nodes = index.get("nodes")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        raise WeatherSpatialIndexError("天气空间索引没有节点")

    nodes: dict[str, dict[str, Any]] = {}
    for node in raw_nodes:
        if not isinstance(node, dict):
            raise WeatherSpatialIndexError("天气空间索引包含非对象节点")
        code = str(node.get("code", "")).strip()
        level = node.get("level")
        if not code or code in nodes or level not in LEVELS:
            raise WeatherSpatialIndexError(f"天气空间索引节点代码或层级无效：{code}")
        if not isinstance(node.get("childrenCodes"), list):
            raise WeatherSpatialIndexError(f"天气空间索引 childrenCodes 无效：{code}")
        nodes[code] = node

    roots = [node for node in nodes.values() if node.get("parentCode") is None]
    if len(roots) != 1 or roots[0].get("code") != "330000" or roots[0].get("level") != "province":
        raise WeatherSpatialIndexError("天气空间索引必须且只能有浙江省根节点")

    for code, node in nodes.items():
        level_index = LEVELS.index(node["level"])
        parent_code = node.get("parentCode")
        if level_index:
            parent = nodes.get(parent_code)
            if parent is None or parent["level"] != LEVELS[level_index - 1] or code not in parent["childrenCodes"]:
                raise WeatherSpatialIndexError(f"天气空间索引父子关系无效：{code}")
        for child_code in node["childrenCodes"]:
            child = nodes.get(child_code)
            if child is None or child.get("parentCode") != code:
                raise WeatherSpatialIndexError(f"天气空间索引子节点引用无效：{code}->{child_code}")
    return nodes


def load_trusted_weather_spatial_index(data_dir: Path) -> dict[str, dict[str, Any]]:
    """Fail closed 地加载索引，并逐节点核对最终边界与代表点 covers 关系。"""
    data_dir = Path(data_dir)
    index = _read_json(data_dir / INDEX_RELATIVE_PATH)
    nodes = _validate_tree(index)
    feature_cache: dict[str, dict[str, dict[str, Any]]] = {}
    for code, node in nodes.items():
        boundary = node.get("boundary")
        point = node.get("representativePoint")
        if not isinstance(boundary, dict) or not isinstance(point, list) or len(point) != 2:
            raise WeatherSpatialIndexError(f"天气空间索引边界或代表点结构无效：{code}")
        path = boundary.get("path")
        feature_code = boundary.get("featureCode")
        if not isinstance(path, str) or feature_code != code:
            raise WeatherSpatialIndexError(f"天气空间索引边界引用无效：{code}")
        if path not in feature_cache:
            feature_cache[path] = _load_feature_map(data_dir, path)
        feature = feature_cache[path].get(code)
        if feature is None:
            raise WeatherSpatialIndexError(f"可信边界缺少索引节点：{path}#{code}")
        geometry = _trusted_geometry(feature, f"{path}#{code}")
        try:
            lon, lat = float(point[0]), float(point[1])
        except (TypeError, ValueError) as exc:
            raise WeatherSpatialIndexError(f"天气空间索引代表点不是数值：{code}") from exc
        if not math.isfinite(lon) or not math.isfinite(lat) or not geometry.covers(Point(lon, lat)):
            raise WeatherSpatialIndexError(f"代表点不在最终可信边界内：{code}")
    return nodes


def main() -> int:
    parser = argparse.ArgumentParser(description="生成并校验天气五级可信空间索引")
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parent.parent / "web/public/data")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    try:
        if args.validate_only:
            nodes = load_trusted_weather_spatial_index(args.data_dir)
            print(f"天气空间索引校验通过：{len(nodes)} 个节点")
        else:
            output = write_weather_spatial_index(args.data_dir)
            print(f"天气空间索引已生成并校验：{output}")
        return 0
    except WeatherSpatialIndexError as exc:
        print(f"天气空间索引失败：{exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

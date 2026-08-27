# -*- coding: utf-8 -*-
"""
受灾预警 V1 —— ERA5 历史归档降雨拉取 + 每节点过程累计网格（T1 / 契约 6.2 / R2-14/R2-15）

- Open-Meteo archive 端点，2026-07-09 ~ 07-13 逐小时降水，0.25° 浙江网格（21×19=399 请求点）
- 分块 50 坐标/请求（实测全网格约 15s）；**存接口返回的吸附 lat/lon**（非请求值、非 0.25 整数倍；
  399 请求点去重后 398 唯一节点）
- 原始响应逐块缓存到 .dev-runtime/disaster/era5-raw/（gitignored），离线可重跑（--refresh 强制重拉）
- 过程累计 cum[i] = 自 2026-07-09 00:00 累计至 track 节点时刻（含该小时），单调不减

产物: web/public/data/disaster/precip.json
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from disaster_common import (  # noqa: E402
    ARCHIVE_END,
    ARCHIVE_START,
    ARCHIVE_URL,
    CACHE_DIR,
    DISASTER_DIR,
    LAT_MAX,
    LAT_MIN,
    LAT_STEP,
    LON_MAX,
    LON_MIN,
    LON_STEP,
    load_json,
    save_json,
)

ERA5_RAW_CACHE = CACHE_DIR / f"era5-raw-{ARCHIVE_START}-{ARCHIVE_END}.json"
CHUNK_SIZE = 50
TIMEOUT_MS = 280_000
MAX_RESPONSE_BYTES = 50 * 1024 * 1024


class DisasterDataError(Exception):
    pass


def build_request_points() -> tuple:
    """浙江 0.25° 网格请求点：纬度外层、经度内层配对（同现有降水服务）。"""
    lons = [round(LON_MIN + LON_STEP * i, 3) for i in range(int(round((LON_MAX - LON_MIN) / LON_STEP)) + 1)]
    lats = [round(LAT_MIN + LAT_STEP * i, 3) for i in range(int(round((LAT_MAX - LAT_MIN) / LAT_STEP)) + 1)]
    return lats, lons


def fetch_chunk(lats, lons) -> list:
    """拉取一块（≤50 点），返回 Open-Meteo 数组（每元素一个吸附节点）。"""
    lat_param = ",".join(str(lat) for lat in lats)
    lon_param = ",".join(str(lon) for lon in lons)
    q = (f"{ARCHIVE_URL}?latitude={lat_param}&longitude={lon_param}"
         f"&start_date={ARCHIVE_START}&end_date={ARCHIVE_END}"
         f"&hourly=precipitation&timezone=Asia%2FShanghai")
    req = urllib.request.Request(q, headers={"accept": "application/json", "user-agent": "agri-insurance-demo/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_MS) as resp:
            raw = resp.read()
    except Exception as exc:
        raise DisasterDataError(f"ERA5 拉取失败: {exc}") from exc
    if len(raw) > MAX_RESPONSE_BYTES:
        raise DisasterDataError(f"ERA5 响应超上限 {len(raw)} 字节")
    payload = json.loads(raw.decode("utf-8"))
    items = payload if isinstance(payload, list) else [payload]
    return items


def load_or_fetch_raw(use_cache: bool) -> list:
    """优先读合并缓存（离线可重跑）；否则分块拉取并落合并缓存。"""
    if use_cache and ERA5_RAW_CACHE.exists():
        print(f"  使用缓存 {ERA5_RAW_CACHE.name}")
        return load_json(ERA5_RAW_CACHE)
    lats, lons = build_request_points()
    pairs = [(lat, lon) for lat in lats for lon in lons]  # 纬度外层 × 经度内层，399 对
    items_all = []
    for i in range(0, len(pairs), CHUNK_SIZE):
        chunk = pairs[i:i + CHUNK_SIZE]
        items = fetch_chunk([p[0] for p in chunk], [p[1] for p in chunk])
        items_all.extend(items)
        print(f"  chunk {i // CHUNK_SIZE + 1}: 累计 {len(items_all)} 条")
    save_json(ERA5_RAW_CACHE, items_all)
    print(f"  原始响应缓存已写 {ERA5_RAW_CACHE.name}")
    return items_all


def dedupe_raw(items_all: list) -> tuple:
    """按吸附 lat/lon（3 位小数）去重 → (nodes dict, order list)。"""
    nodes = {}
    order = []
    for item in items_all:
        key = (round(float(item["latitude"]), 3), round(float(item["longitude"]), 3))
        if key not in nodes:
            nodes[key] = item["hourly"]["precipitation"]
            order.append(key)
    return nodes, order


def align_hour_index(node_time: str) -> int:
    """北京时间 'YYYY-MM-DD HH:00:00' → 相对 7/9 00:00 的小时序号。"""
    day, hhmm = node_time[:10], node_time[11:13]
    ref = ARCHIVE_START
    from datetime import datetime
    d0 = datetime.strptime(ref, "%Y-%m-%d")
    d1 = datetime.strptime(day, "%Y-%m-%d")
    return (d1 - d0).days * 24 + int(hhmm)


def compute_cumulative(hourly: list, node_times: list) -> tuple:
    """逐小时降水 → 累计数组（前缀和，len = len(hourly)+1），再取各节点时刻的累计值。

    返回 (cumAtNodes, cumHourly)：
      - cumAtNodes[i] = 自 7/9 00:00 累计至 node_times[i] 时刻（契约 6.2 字段 cum）
      - cumHourly[k] = 自 7/9 00:00 累计至第 k 个小时（len = len(hourly)+1，用于未来 24h 预警计算）
    """
    cum = [0.0]
    for v in hourly:
        cum.append(cum[-1] + float(v or 0.0))
    result = []
    for t in node_times:
        idx = align_hour_index(t)
        result.append(round(cum[idx], 3))
    # 单调不减断言（R2-15）：cum 前缀和天然单调
    for a, b in zip(result, result[1:]):
        if b < a - 1e-9:
            raise DisasterDataError(f"累计雨量非单调: {a} -> {b}")
    cum_hourly = [round(v, 6) for v in cum]
    return result, cum_hourly


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="ERA5 历史降雨固化 -> web/public/data/disaster/precip.json")
    parser.add_argument("--refresh", action="store_true", help="忽略缓存强制重拉上游")
    parser.add_argument("--track", type=str, default=str(DISASTER_DIR / "track.json"))
    parser.add_argument("--out", type=str, default=str(DISASTER_DIR / "precip.json"))
    args = parser.parse_args(argv)

    if args.refresh:
        ERA5_RAW_CACHE.unlink(missing_ok=True)
    items_all = load_or_fetch_raw(use_cache=not args.refresh)
    nodes, order = dedupe_raw(items_all)
    print(f"  去重后唯一节点 {len(nodes)}")
    track = load_json(Path(args.track))
    node_times = [d["time_ymdh"] for d in track["datas"]]
    if len(node_times) != 71:
        print(f"⚠️  注意：track 节点数 {len(node_times)}（契约基线 71），precip 按实际对齐")

    grid = []
    for lat, lon in order:
        hourly = nodes[(lat, lon)]
        cum_at_nodes, cum_hourly = compute_cumulative(hourly, node_times)
        # hourly 原始值随产物保存：预警计算需 float32 前缀和精确复现校准基线（R3-5）
        grid.append({"lat": lat, "lon": lon, "cum": cum_at_nodes,
                     "cumHourly": cum_hourly, "hourly": [float(v or 0.0) for v in hourly]})

    out = Path(args.out)
    save_json(out, {
        "schemaVersion": 1,
        "model": "ERA5 0.25° (Open-Meteo archive)",
        "aggregateFrom": "2026-07-09 00:00:00",
        "nodeTimes": node_times,
        "grid": grid,
    })
    print(f"✅ precip.json 已写 {out}  节点数={len(grid)}  格点时间序列={len(node_times)}  "
          f"单点累计示例 {grid[0]['lat']},{grid[0]['lon']} -> {grid[0]['cum'][-1]}mm")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

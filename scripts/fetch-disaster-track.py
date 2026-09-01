# -*- coding: utf-8 -*-
"""
受灾预警 V1 —— 巴威轨迹固化（T1 / 契约 6.1 / R2-17）

- 走 APIHz 上游（server/.env.local 的 APIHZ_DEVELOPER_ID / APIHZ_KEY 直连，本机已实测可通）
- 过滤影响窗口（2026-07-09 00:00:00 ~ 2026-07-13 00:00:00）内 71 个节点
- 保持上游原始字段名（time_ymdh / wind_radius 等），前端 typhoonAdapter 零改动消费
- 原始响应缓存到 .dev-runtime/disaster/（gitignored），离线可重跑（--refresh 强制重拉）

产物: web/public/data/disaster/track.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from disaster_common import (  # noqa: E402
    CACHE_DIR,
    DISASTER_DIR,
    SERVER_ENV,
    WINDOW_END,
    WINDOW_START,
    load_json,
    save_json,
)

UPSTREAM_LIST_URL = "https://cn.apihz.cn/api/tianqi/taifeng.php"
BAVI_YEAR = 2026
BAVI_NO1 = "3257931"  # 形态预检实测：2026 年第 9 号 巴威
CACHE_LIST = CACHE_DIR / "apihz-typhoon-list-2026.json"
CACHE_DETAIL = CACHE_DIR / "apihz-typhoon-3257931.json"


class DisasterDataError(Exception):
    pass


def read_credentials() -> tuple:
    """从 server/.env.local 读取 APIHz 凭据（不打印、不写产物）。"""
    if not SERVER_ENV.exists():
        raise DisasterDataError("server/.env.local 不存在，无法读取 APIHz 凭据")
    text = SERVER_ENV.read_text(encoding="utf-8")
    dev_id = re.search(r"^APIHZ_DEVELOPER_ID=(.+)$", text, re.M)
    key = re.search(r"^APIHZ_KEY=(.+)$", text, re.M)
    if not dev_id or not key:
        raise DisasterDataError("server/.env.local 缺少 APIHZ_DEVELOPER_ID / APIHZ_KEY")
    return dev_id.group(1).strip(), key.group(1).strip()


def _http_get_json(url: str, timeout: int = 60) -> dict:
    req = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "agri-insurance-demo/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except Exception as exc:
        raise DisasterDataError(f"上游请求失败: {exc}") from exc
    if len(raw) > 20 * 1024 * 1024:
        raise DisasterDataError("上游响应超过 20MB 上限")
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise DisasterDataError(f"上游响应非合法 JSON: {exc}") from exc


def fetch_typhoon_list(dev_id: str, key: str, use_cache: bool = True) -> dict:
    if use_cache and CACHE_LIST.exists():
        return load_json(CACHE_LIST)
    url = f"{UPSTREAM_LIST_URL}?id={dev_id}&key={key}&year={BAVI_YEAR}"
    payload = _http_get_json(url)
    if payload.get("code") != 200:
        raise DisasterDataError(f"台风列表接口返回非 200: {payload.get('code')} {payload.get('msg')}")
    save_json(CACHE_LIST, payload)
    return payload


def fetch_typhoon_detail(dev_id: str, key: str, no1: str, use_cache: bool = True) -> dict:
    if use_cache and CACHE_DETAIL.exists():
        return load_json(CACHE_DETAIL)
    url = f"{UPSTREAM_LIST_URL}?id={dev_id}&key={key}&no={no1}"
    payload = _http_get_json(url)
    if payload.get("code") != 200:
        raise DisasterDataError(f"台风详情接口返回非 200: {payload.get('code')} {payload.get('msg')}")
    save_json(CACHE_DETAIL, payload)
    return payload


def find_bavi(payload: dict) -> dict:
    for item in payload.get("list", []):
        if "巴威" in str(item.get("namecn", "")):
            return item
    raise DisasterDataError("2026 年台风列表中未找到巴威")


def filter_window(datas: list) -> list:
    """过滤影响窗口节点，按时间升序。"""
    win = [d for d in datas if WINDOW_START <= d.get("time_ymdh", "") <= WINDOW_END]
    win.sort(key=lambda d: d.get("time_ymdh", ""))
    return win


def build_track(detail: dict, window: list) -> dict:
    """契约 6.1：保留上游字段名，datas 仅窗口内节点。"""
    return {
        "code": 200,
        "no1": detail.get("no1"),
        "no2": detail.get("no2"),
        "no3": detail.get("no3"),
        "no4": detail.get("no4", ""),
        "namecn": detail.get("namecn"),
        "nameen": detail.get("nameen"),
        "explanation": detail.get("explanation"),
        "type": detail.get("type"),
        "datas": window,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="巴威轨迹固化 -> web/public/data/disaster/track.json")
    parser.add_argument("--refresh", action="store_true", help="忽略缓存强制重拉上游")
    parser.add_argument("--out", type=str, default=str(DISASTER_DIR / "track.json"))
    args = parser.parse_args(argv)

    dev_id, key = read_credentials()
    list_payload = fetch_typhoon_list(dev_id, key, use_cache=not args.refresh)
    bavi = find_bavi(list_payload)
    detail = fetch_typhoon_detail(dev_id, key, bavi.get("no1", BAVI_NO1), use_cache=not args.refresh)
    window = filter_window(detail.get("datas", []))
    track = build_track(detail, window)
    out = Path(args.out)
    save_json(out, track)
    print(f"✅ track.json 已写 {out}  节点数={len(window)}  "
          f"范围 {window[0]['time_ymdh'][:16]} ~ {window[-1]['time_ymdh'][:16]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

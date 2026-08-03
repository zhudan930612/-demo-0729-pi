# -*- coding: utf-8 -*-
"""天气空间数据修正规则的公共来源字段校验。"""

from __future__ import annotations

from datetime import date
from typing import Any
from urllib.parse import urlparse


def validate_sources(sources: Any, reference: str, error_type: type[ValueError]) -> None:
    if not isinstance(sources, list) or not sources:
        raise error_type(f"{reference}缺少公开来源")
    for index, source in enumerate(sources):
        if not isinstance(source, dict):
            raise error_type(f"{reference}来源结构无效：{index}")
        url = source.get("url")
        parsed = urlparse(url) if isinstance(url, str) else None
        if not parsed or parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise error_type(f"{reference}来源 URL 无效：{index}")
        if not isinstance(source.get("publisher"), str) or not source["publisher"].strip():
            raise error_type(f"{reference}来源发布主体无效：{index}")
        if not isinstance(source.get("reason"), str) or not source["reason"].strip():
            raise error_type(f"{reference}来源用途无效：{index}")
        try:
            accessed = date.fromisoformat(source.get("accessed", ""))
        except (TypeError, ValueError) as exc:
            raise error_type(f"{reference}来源访问日期无效：{index}") from exc
        if accessed > date.today():
            raise error_type(f"{reference}来源访问日期晚于当前日期：{index}")

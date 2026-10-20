"""天气提醒 — 支持城市搜索与地区切换。

使用和风天气实时接口（v7）+ 城市搜索（geo/v2）。
新版 API Host + X-QW-Api-Key 请求头认证。
"""
import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.config import get_settings
from app.database import get_session
from app.deps import get_current_user
from app.models import User

logger = logging.getLogger("weather")
router = APIRouter(prefix="/api/weather", tags=["weather"])

CACHE_SECONDS = 900  # 15 分钟缓存
DEFAULT_LOCATION_ID = ""
DEFAULT_LOCATION_NAME = "未设置"


# ── 请求/响应模型 ─────────────────────────────────────────────

class WeatherLocationSave(BaseModel):
    location_id: str = Field(min_length=1, max_length=20)
    location_name: str = Field(min_length=1, max_length=100)
    adm1: str = Field(default="", max_length=100)
    adm2: str = Field(default="", max_length=100)


class CitySearchItem(BaseModel):
    id: str
    name: str
    adm1: str
    adm2: str
    country: str
    displayName: str


# ── 缓存 ──────────────────────────────────────────────────────

@dataclass
class _Cache:
    data: dict[str, Any] | None = None
    fetched_at: float = 0.0
    location_id: str = ""


_cache = _Cache()


# ── 辅助函数 ──────────────────────────────────────────────────

def _fallback_payload(reason: str) -> dict[str, Any]:
    return {
        "locationName": DEFAULT_LOCATION_NAME,
        "adm1": "",
        "adm2": "",
        "text": "天气暂不可用",
        "temp": None,
        "feelsLike": None,
        "windDir": None,
        "windScale": None,
        "humidity": None,
        "obsTime": None,
        "source": "qweather",
        "rain_warning": reason,
        "ok": False,
    }


def _rain_warning(precip_pct: float | None) -> str:
    if precip_pct is not None and precip_pct >= 50:
        return "今天可能下雨，出门记得带伞。"
    if precip_pct is not None and precip_pct >= 30:
        return "今天降雨概率较低，正常出门即可。"
    return "今天预计无雨，放心出门。"


def _as_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _mask_key(key: str) -> str:
    key = key.strip()
    if len(key) <= 6:
        return "***"
    return f"{key[:3]}***{key[-4:]}"


def _resolve_api_host(settings) -> str:
    host = settings.weather_api_host.strip()
    if host:
        host = host.removeprefix("https://").removeprefix("http://").rstrip("/")
    if not host:
        host = "devapi.qweather.com"
    return host


def _check_config(settings) -> str | None:
    """检查天气配置，返回错误信息或 None。"""
    if not settings.weather_api_key.strip():
        return "未配置天气 Key"
    if not settings.weather_api_host.strip():
        return "未配置天气 API Host"
    return None


# ── 天气数据获取 ──────────────────────────────────────────────

def _fetch_qweather(location_id: str) -> dict[str, Any]:
    """调用和风天气 v7 now/3d 接口。"""
    settings = get_settings()
    api_host = _resolve_api_host(settings)
    api_key = settings.weather_api_key.strip()
    headers = {"X-QW-Api-Key": api_key}
    params = {"location": location_id, "lang": "zh"}

    with httpx.Client(timeout=10.0) as client:
        # 实时天气
        now_url = f"https://{api_host}/v7/weather/now"
        now_resp = client.get(now_url, params=params, headers=headers)
        now_resp.raise_for_status()
        now_data = now_resp.json()
        now_code = str(now_data.get("code", ""))
        if now_code != "200":
            logger.warning(
                "qweather now error: code=%s, host=%s, key=%s, location=%s",
                now_code, api_host, _mask_key(api_key), location_id,
            )
            raise RuntimeError(f"qweather now code={now_code}")

        # 3 日预报（用于温度范围等补充信息，非必须）
        forecast_url = f"https://{api_host}/v7/weather/3d"
        forecast_resp = client.get(forecast_url, params=params, headers=headers)
        forecast_resp.raise_for_status()
        forecast_data = forecast_resp.json()
        forecast_code = str(forecast_data.get("code", ""))
        if forecast_code != "200":
            logger.warning(
                "qweather forecast error: code=%s, host=%s, key=%s",
                forecast_code, api_host, _mask_key(api_key),
            )
            forecast_data = {}

        current = now_data.get("now") or {}
        today = (forecast_data.get("daily") or [{}])[0] if forecast_data else {}

    precip = _as_float(current.get("precip"))
    precip_pct = 90 if (precip is not None and precip >= 0.1) else 10

    return {
        "locationName": "",
        "adm1": "",
        "adm2": "",
        "text": current.get("text") or "未知",
        "temp": _as_int(current.get("temp")),
        "feelsLike": _as_int(current.get("feelsLike")),
        "windDir": current.get("windDir"),
        "windScale": current.get("windScale"),
        "humidity": _as_int(current.get("humidity")),
        "obsTime": current.get("obsTime"),
        "source": "qweather",
        "rain_warning": _rain_warning(precip_pct),
        "ok": True,
    }


# ── 城市搜索 ──────────────────────────────────────────────────

def _search_city(keyword: str, settings) -> list[dict[str, Any]]:
    """调用和风天气城市搜索 API。"""
    api_host = _resolve_api_host(settings)
    api_key = settings.weather_api_key.strip()
    headers = {"X-QW-Api-Key": api_key}
    params = {"location": keyword, "range": "cn", "number": "10", "lang": "zh"}

    url = f"https://{api_host}/geo/v2/city/lookup"
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(url, params=params, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    code = str(data.get("code", ""))
    if code != "200":
        logger.warning(
            "qweather city search error: code=%s, host=%s, key=%s, keyword=%s",
            code, api_host, _mask_key(api_key), keyword,
        )
        raise RuntimeError(f"qweather city search code={code}")

    location_list = data.get("location") or []
    results: list[dict[str, Any]] = []
    for loc in location_list:
        item_id = str(loc.get("id", ""))
        item_name = loc.get("name", "")
        item_adm1 = loc.get("adm1", "")
        item_adm2 = loc.get("adm2", "")
        item_country = loc.get("country", "")
        # 构建 displayName: 区县 / 城市 / 省份 / 国家
        parts = [item_name]
        if item_adm2 and item_adm2 != item_name:
            parts.append(item_adm2)
        if item_adm1 and item_adm1 not in parts:
            parts.append(item_adm1)
        if item_country and item_country not in parts:
            parts.append(item_country)
        results.append({
            "id": item_id,
            "name": item_name,
            "adm1": item_adm1,
            "adm2": item_adm2,
            "country": item_country,
            "displayName": " / ".join(parts),
        })
    return results


# ── API 端点 ──────────────────────────────────────────────────

@router.get("/search")
def search_city(
    keyword: str = Query(min_length=1, max_length=50),
    current_user: User = Depends(get_current_user),
) -> list[CitySearchItem]:
    """搜索城市/区县，用于地区切换。"""
    settings = get_settings()
    err = _check_config(settings)
    if err:
        raise HTTPException(status_code=503, detail=err)
    try:
        results = _search_city(keyword, settings)
    except Exception:
        logger.warning("城市搜索失败，keyword=%s", keyword, exc_info=True)
        raise HTTPException(status_code=502, detail="城市搜索服务暂不可用，请稍后再试")
    if not results:
        raise HTTPException(status_code=404, detail="未找到地区，请换个关键词")
    return [CitySearchItem(**r) for r in results]


@router.post("/location")
def save_weather_location(
    payload: WeatherLocationSave,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """保存当前用户的天气地区偏好。"""
    current_user.weather_location_id = payload.location_id
    current_user.weather_location_name = payload.location_name
    current_user.weather_location_adm1 = payload.adm1
    current_user.weather_location_adm2 = payload.adm2
    session.add(current_user)
    session.commit()
    # 清除天气缓存
    global _cache
    _cache = _Cache()
    return {"ok": True}


@router.get("/today")
def get_today_weather(
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """获取天气；用户需要先选择自己的地区。"""
    settings = get_settings()
    now = time.time()

    err = _check_config(settings)
    if err:
        return _fallback_payload(err)

    # 解析地区
    location_id = current_user.weather_location_id or DEFAULT_LOCATION_ID
    if not location_id:
        return _fallback_payload("请先选择天气地区")

    # 缓存检查（按 location_id 区分）
    if _cache.data is not None and _cache.location_id == location_id and (now - _cache.fetched_at) < CACHE_SECONDS:
        return _cache.data

    try:
        data = _fetch_qweather(location_id)
        # 填充地区名称
        if current_user.weather_location_name:
            data["locationName"] = current_user.weather_location_name
            data["adm1"] = current_user.weather_location_adm1 or ""
            data["adm2"] = current_user.weather_location_adm2 or ""
        else:
            data["locationName"] = DEFAULT_LOCATION_NAME
        _cache.data = data
        _cache.location_id = location_id
        _cache.fetched_at = now
        return data
    except Exception:
        logger.warning("天气接口请求失败，已返回降级提示", exc_info=True)
        return _fallback_payload("天气服务暂不可用，请检查和风天气 Key")

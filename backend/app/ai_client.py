from dataclasses import dataclass
import logging
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException, status

from app.config import Settings
from app.config import get_settings

logger = logging.getLogger("chuji.ai")


# 已知支持图片/视觉识别的模型名称关键词
_VISION_MODEL_PATTERNS = (
    "gpt-4o", "gpt-4-turbo", "gpt-4-vision", "gpt-4.1",
    "claude", "fable", "opus", "sonnet", "haiku",
    "gemini",
    "glm-4v", "cogview", "cogvlm",
    "qwen-vl", "qwen2-vl", "qwenvl",
    "llava", "llama-v", "llama-4",
    "yi-vision", "yi-vl",
    "deepseek-vl", "deepseek-vl2",
    "internvl", "intern-vl",
    "pixtral",
    "step", "hunyuan",
    "vision", "multimodal", "vl-",
)


def is_vision_model(model: str) -> bool:
    """检查模型名是否可能支持图片识别（启发式匹配）。"""
    lower = model.lower().strip()
    for pat in _VISION_MODEL_PATTERNS:
        if pat in lower:
            return True
    return False


@dataclass(frozen=True)
class ChatConfig:
    base_url: str
    api_key: str
    model: str

    @property
    def configured(self) -> bool:
        return bool(self.base_url.strip() and self.api_key.strip() and self.model.strip())


def chat_url(base_url: str) -> str:
    base = base_url.strip().rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def validate_chat_base_url(base_url: str, *, app_env: str) -> None:
    try:
        parsed = urlparse(base_url.strip())
        hostname = parsed.hostname
    except ValueError:
        hostname = None
        parsed = urlparse("")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="AI/OCR Base URL 不得包含凭据、查询参数或片段")
    if parsed.scheme == "https" and hostname:
        return
    local_hosts = {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme == "http" and hostname in local_hosts and app_env.strip().lower() not in {"prod", "production"}:
        return
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="AI/OCR Base URL 必须使用 HTTPS；仅开发环境允许 localhost HTTP")


def ai_config(settings: Settings) -> ChatConfig:
    return ChatConfig(
        base_url=settings.ai_base_url,
        api_key=settings.ai_api_key,
        model=settings.ai_model,
    )


def ocr_config(settings: Settings) -> ChatConfig:
    return ChatConfig(
        base_url=settings.ocr_base_url or settings.ai_base_url,
        api_key=settings.ocr_api_key or settings.ai_api_key,
        model=settings.ocr_model or settings.ai_model,
    )


def require_config(config: ChatConfig, *, message: str = "请先配置 AI/OCR Key") -> ChatConfig:
    if not config.configured:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
    return config


def call_chat_completion(
    config: ChatConfig,
    messages: list[dict[str, Any]],
    *,
    temperature: float = 0.3,
    max_tokens: int | None = None,
    timeout: float = 45.0,
    failure_message: str = "AI 服务暂时不可用",
) -> str:
    require_config(config)
    validate_chat_base_url(config.base_url, app_env=get_settings().app_env)
    payload: dict[str, Any] = {
        "model": config.model.strip(),
        "messages": messages,
        "temperature": temperature,
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens

    try:
        response = httpx.post(
            chat_url(config.base_url),
            json=payload,
            headers={"Authorization": f"Bearer {config.api_key.strip()}"},
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
    except Exception as exc:
        logger.warning("model request failed model=%s error_type=%s", config.model.strip(), type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=failure_message,
        ) from exc

    if not isinstance(content, str) or not content.strip():
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=failure_message)
    return content.strip()

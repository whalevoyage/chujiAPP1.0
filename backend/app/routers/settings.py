from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.audit import add_audit_log
from app.config import PROJECT_ROOT, get_settings
from app.database import get_session
from app.deps import require_admin
from app.models import User
from app.routers.attachments import _read_delete_password, _write_delete_password, verify_delete_password

router = APIRouter(prefix="/api/settings", tags=["settings"])

ENV_PATH = PROJECT_ROOT / ".env"

KEY_FIELDS = {
    "ai_base_url": "AI_BASE_URL",
    "ai_api_key": "AI_API_KEY",
    "ai_model": "AI_MODEL",
    "weather_api_key": "WEATHER_API_KEY",
    "weather_api_host": "WEATHER_API_HOST",
    "ocr_api_key": "OCR_API_KEY",
    "ocr_base_url": "OCR_BASE_URL",
    "ocr_model": "OCR_MODEL",
}


class ApiKeyStatus(BaseModel):
    configured: bool
    masked: str | None = None


class ApiKeySettingsRead(BaseModel):
    ai_configured: bool
    ai_api_key: ApiKeyStatus
    ai_base_url: str
    ai_model: str
    weather_api_key: ApiKeyStatus
    weather_api_host: str
    ocr_configured: bool
    ocr_api_key: ApiKeyStatus
    ocr_base_url: str
    ocr_model: str


class ApiKeySettingsUpdate(BaseModel):
    ai_base_url: str | None = Field(default=None, max_length=500)
    ai_api_key: str | None = Field(default=None, max_length=500)
    ai_model: str | None = Field(default=None, max_length=100)
    weather_api_key: str | None = Field(default=None, max_length=500)
    weather_api_host: str | None = Field(default=None, max_length=500)
    ocr_api_key: str | None = Field(default=None, max_length=500)
    ocr_base_url: str | None = Field(default=None, max_length=500)
    ocr_model: str | None = Field(default=None, max_length=100)


class ChangeDeletePasswordRequest(BaseModel):
    old_password: str = Field(default="", max_length=64)
    new_password: str = Field(min_length=1, max_length=64)


class DeletePasswordStatus(BaseModel):
    configured: bool
    has_password: bool


def mask_key(value: str) -> str | None:
    value = value.strip()
    if not value:
        return None
    if len(value) <= 6:
        return "***"
    prefix = value[:3]
    suffix = value[-4:]
    return f"{prefix}***{suffix}"


def key_status(value: str) -> ApiKeyStatus:
    value = value.strip()
    return ApiKeyStatus(configured=bool(value), masked=mask_key(value))


def read_env_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    return path.read_text(encoding="utf-8").splitlines()


def update_env_values(updates: dict[str, str]) -> None:
    lines = read_env_lines(ENV_PATH)
    seen: set[str] = set()
    next_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            next_lines.append(line)
            continue
        key, _ = line.split("=", 1)
        key = key.strip()
        if key in updates:
            next_lines.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            next_lines.append(line)

    missing = [(key, value) for key, value in updates.items() if key not in seen]
    if missing and next_lines and next_lines[-1].strip():
        next_lines.append("")
    for key, value in missing:
        next_lines.append(f"{key}={value}")

    ENV_PATH.write_text("\n".join(next_lines).rstrip() + "\n", encoding="utf-8")
    get_settings.cache_clear()


def validate_provider_url(field: str, value: str | None) -> None:
    if value is None or not value.strip():
        return
    try:
        parsed = urlparse(value.strip())
        hostname = parsed.hostname
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field} 格式无效。") from None
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field} 不得在 URL 中嵌入凭据、查询参数或片段。",
        )
    if parsed.scheme == "https" and hostname:
        return
    settings = get_settings()
    local_hosts = {"localhost", "127.0.0.1", "::1"}
    if (
        parsed.scheme == "http"
        and hostname in local_hosts
        and settings.app_env.strip().lower() not in {"prod", "production"}
    ):
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"{field} 必须使用 HTTPS；仅开发环境允许 localhost HTTP。",
    )


@router.get("/api-keys", response_model=ApiKeySettingsRead)
def get_api_key_settings(current_user: User = Depends(require_admin)) -> ApiKeySettingsRead:
    settings = get_settings()
    ai_configured = bool(
        settings.ai_base_url.strip()
        and settings.ai_api_key.strip()
        and settings.ai_model.strip()
    )
    ocr_base_url = settings.ocr_base_url or settings.ai_base_url
    ocr_model = settings.ocr_model or settings.ai_model
    ocr_configured = bool(
        ocr_base_url.strip()
        and (settings.ocr_api_key or settings.ai_api_key).strip()
        and ocr_model.strip()
    )
    return ApiKeySettingsRead(
        ai_configured=ai_configured,
        ai_api_key=key_status(settings.ai_api_key),
        ai_base_url=settings.ai_base_url,
        ai_model=settings.ai_model,
        weather_api_key=key_status(settings.weather_api_key),
        weather_api_host=settings.weather_api_host,
        ocr_configured=ocr_configured,
        ocr_api_key=key_status(settings.ocr_api_key),
        ocr_base_url=ocr_base_url,
        ocr_model=ocr_model,
    )


@router.put("/api-keys", response_model=ApiKeySettingsRead)
def update_api_key_settings(
    payload: ApiKeySettingsUpdate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_admin),
) -> ApiKeySettingsRead:
    raw = payload.model_dump(exclude_unset=True)
    validate_provider_url("AI_BASE_URL", raw.get("ai_base_url"))
    validate_provider_url("OCR_BASE_URL", raw.get("ocr_base_url"))
    updates: dict[str, str] = {}
    changed: list[str] = []
    for field, value in raw.items():
        env_key = KEY_FIELDS.get(field)
        if env_key is None or value is None:
            continue
        updates[env_key] = str(value).strip()
        changed.append(field)

    if updates:
        update_env_values(updates)
        add_audit_log(
            session,
            request=request,
            action="settings.api_keys.update",
            user_id=current_user.id,
            detail={"changed": changed},
        )
        session.commit()

    return get_api_key_settings(current_user)


# ── 删除密码管理 ──────────────────────────────────────────────


@router.get("/delete-password", response_model=DeletePasswordStatus)
def get_delete_password_status(current_user: User = Depends(require_admin)) -> DeletePasswordStatus:
    pw = _read_delete_password()
    return DeletePasswordStatus(configured=bool(pw), has_password=bool(pw))


@router.put("/delete-password")
def change_delete_password(
    payload: ChangeDeletePasswordRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_admin),
) -> dict:
    configured_password = _read_delete_password()
    if configured_password and not verify_delete_password(payload.old_password):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="旧密码错误")
    if not configured_password and payload.old_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前尚未设置删除密码，请留空旧密码")

    new_pw = payload.new_password.strip()
    if not new_pw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="新密码不能为空")

    _write_delete_password(new_pw)
    add_audit_log(
        session,
        request=request,
        action="settings.delete_password_changed",
        user_id=current_user.id,
        detail={},
    )
    session.commit()
    return {"ok": True}

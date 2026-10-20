from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.audit import add_audit_log
from app.config import PROJECT_ROOT, get_settings
from app.database import get_session
from app.deps import get_current_user
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
    old_password: str = Field(min_length=1, max_length=64)
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


@router.get("/api-keys", response_model=ApiKeySettingsRead)
def get_api_key_settings(current_user: User = Depends(get_current_user)) -> ApiKeySettingsRead:
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
    current_user: User = Depends(get_current_user),
) -> ApiKeySettingsRead:
    raw = payload.model_dump(exclude_unset=True)
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
def get_delete_password_status(current_user: User = Depends(get_current_user)) -> DeletePasswordStatus:
    pw = _read_delete_password()
    return DeletePasswordStatus(configured=bool(pw), has_password=bool(pw))


@router.put("/delete-password")
def change_delete_password(
    payload: ChangeDeletePasswordRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    if not verify_delete_password(payload.old_password):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="旧密码错误")

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

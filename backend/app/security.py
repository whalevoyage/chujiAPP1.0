import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from threading import Lock

import bcrypt
from fastapi import HTTPException, Response, status

from app.config import get_settings, project_path


SESSION_SECRET_FILE = project_path("data", "session_secret.key")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def validate_password_strength(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="新密码至少需要 8 位")
    if not any(char.islower() for char in password):
        raise HTTPException(status_code=400, detail="新密码需要包含小写字母")
    if not any(char.isupper() for char in password):
        raise HTTPException(status_code=400, detail="新密码需要包含大写字母")
    if not any(char.isdigit() for char in password):
        raise HTTPException(status_code=400, detail="新密码需要包含数字")
    if not any(not char.isalnum() for char in password):
        raise HTTPException(status_code=400, detail="新密码需要包含符号")


def get_session_secret() -> str:
    settings = get_settings()
    configured = settings.session_secret.strip()
    if configured and configured != "replace-with-a-local-random-secret":
        return configured

    SESSION_SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    if SESSION_SECRET_FILE.exists():
        return SESSION_SECRET_FILE.read_text(encoding="utf-8").strip()

    generated = secrets.token_urlsafe(48)
    SESSION_SECRET_FILE.write_text(generated, encoding="utf-8")
    return generated


def _urlsafe_b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _urlsafe_b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def create_session_token(user_id: int) -> str:
    settings = get_settings()
    now = int(time.time())
    payload = {"uid": user_id, "iat": now, "exp": now + settings.session_max_age_seconds}
    payload_raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    payload_part = _urlsafe_b64encode(payload_raw)
    signature = hmac.new(
        get_session_secret().encode("utf-8"),
        payload_part.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{payload_part}.{_urlsafe_b64encode(signature)}"


def verify_session_token(token: str) -> int | None:
    try:
        payload_part, signature_part = token.split(".", 1)
        expected = hmac.new(
            get_session_secret().encode("utf-8"),
            payload_part.encode("ascii"),
            hashlib.sha256,
        ).digest()
        supplied = _urlsafe_b64decode(signature_part)
        if not hmac.compare_digest(expected, supplied):
            return None
        payload = json.loads(_urlsafe_b64decode(payload_part).decode("utf-8"))
        if int(payload["exp"]) < int(time.time()):
            return None
        return int(payload["uid"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def set_session_cookie(response: Response, user_id: int) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=create_session_token(user_id),
        max_age=settings.session_max_age_seconds,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )


@dataclass
class LoginBucket:
    failures: list[datetime]
    locked_until: datetime | None = None


class LoginRateLimiter:
    def __init__(self) -> None:
        self._buckets: dict[str, LoginBucket] = {}
        self._lock = Lock()
        self.window = timedelta(minutes=5)
        self.lock_duration = timedelta(minutes=5)
        self.max_failures = 5

    def _key(self, username: str, ip: str | None) -> str:
        return f"{username.strip().lower()}|{ip or 'unknown'}"

    def assert_allowed(self, username: str, ip: str | None) -> None:
        key = self._key(username, ip)
        now = datetime.now(UTC)
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket and bucket.locked_until and bucket.locked_until > now:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="登录失败次数过多，请稍后再试",
                )

    def record_failure(self, username: str, ip: str | None) -> None:
        key = self._key(username, ip)
        now = datetime.now(UTC)
        with self._lock:
            bucket = self._buckets.setdefault(key, LoginBucket(failures=[]))
            bucket.failures = [item for item in bucket.failures if now - item <= self.window]
            bucket.failures.append(now)
            if len(bucket.failures) >= self.max_failures:
                bucket.locked_until = now + self.lock_duration
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="登录失败次数过多，请稍后再试",
                )

    def clear(self, username: str, ip: str | None) -> None:
        with self._lock:
            self._buckets.pop(self._key(username, ip), None)


login_rate_limiter = LoginRateLimiter()

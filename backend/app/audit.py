import json
from typing import Any

from fastapi import Request
from sqlmodel import Session

from app.models import AuditLog


def request_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def request_user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


def add_audit_log(
    session: Session,
    *,
    request: Request,
    action: str,
    user_id: int | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    safe_detail = None
    if detail is not None:
        safe_detail = json.dumps(detail, ensure_ascii=False, separators=(",", ":"))
    session.add(
        AuditLog(
            user_id=user_id,
            action=action,
            ip=request_ip(request),
            user_agent=request_user_agent(request),
            detail=safe_detail,
        )
    )

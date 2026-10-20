from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlmodel import Session

from app.audit import add_audit_log, request_ip
from app.database import get_session
from app.deps import get_current_user, get_user_by_username
from app.models import User, utc_now
from app.schemas import AuthUserResponse, ChangePasswordRequest, LoginRequest
from app.security import (
    clear_session_cookie,
    hash_password,
    login_rate_limiter,
    set_session_cookie,
    validate_password_strength,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=AuthUserResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> dict[str, User]:
    username = payload.username.strip()
    ip = request_ip(request)
    login_rate_limiter.assert_allowed(username, ip)

    user = get_user_by_username(session, username)
    if user is None or not verify_password(payload.password, user.password_hash):
        add_audit_log(
            session,
            request=request,
            action="auth.login_failed",
            user_id=user.id if user else None,
            detail={"username": username, "reason": "invalid_credentials"},
        )
        session.commit()
        login_rate_limiter.record_failure(username, ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    if not user.is_active:
        add_audit_log(
            session,
            request=request,
            action="auth.login_failed",
            user_id=user.id,
            detail={"username": username, "reason": "disabled"},
        )
        session.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="用户已被禁用")

    login_rate_limiter.clear(username, ip)
    now = utc_now()
    user.last_login_at = now
    user.updated_at = now
    add_audit_log(
        session,
        request=request,
        action="auth.login_success",
        user_id=user.id,
        detail={"username": user.username},
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    set_session_cookie(response, user.id)
    from app.routers.backups import maybe_create_daily_auto_backup

    maybe_create_daily_auto_backup(session, request=request, user_id=user.id or 0)
    return {"user": user}


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    add_audit_log(
        session,
        request=request,
        action="auth.logout",
        user_id=current_user.id,
        detail={"username": current_user.username},
    )
    session.commit()
    from app.routers.backups import trigger_light_backup

    trigger_light_backup(session, current_user.id or 0, request=request, reason="logout")
    clear_session_cookie(response)
    return {"message": "已退出登录"}


@router.get("/me", response_model=AuthUserResponse)
def me(
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, User]:
    from app.routers.backups import maybe_create_daily_auto_backup

    maybe_create_daily_auto_backup(session, request=request, user_id=current_user.id or 0)
    return {"user": current_user}


@router.post("/change-password", response_model=AuthUserResponse)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, User]:
    if not verify_password(payload.old_password, current_user.password_hash):
        add_audit_log(
            session,
            request=request,
            action="auth.change_password_failed",
            user_id=current_user.id,
            detail={"reason": "invalid_old_password"},
        )
        session.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="旧密码不正确")

    validate_password_strength(payload.new_password)
    current_user.password_hash = hash_password(payload.new_password)
    current_user.must_change_password = False
    current_user.updated_at = utc_now()
    add_audit_log(
        session,
        request=request,
        action="auth.change_password",
        user_id=current_user.id,
        detail={"username": current_user.username},
    )
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return {"user": current_user}

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlmodel import Session, select

from app.audit import add_audit_log
from app.database import get_session
from app.deps import get_user_by_username, require_admin
from app.models import User, utc_now
from app.schemas import AdminUserCreate, AdminUserUpdate, ResetPasswordRequest, UserRead
from app.security import hash_password, validate_password_strength

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users", response_model=list[UserRead])
def list_users(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[User]:
    return list(session.exec(select(User).order_by(User.created_at)).all())


@router.post("/users", response_model=UserRead)
def create_user(
    payload: AdminUserCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_admin: User = Depends(require_admin),
) -> User:
    username = payload.username.strip()
    if get_user_by_username(session, username) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在")
    validate_password_strength(payload.password)

    now = utc_now()
    user = User(
        username=username,
        nickname=payload.nickname.strip(),
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=payload.is_active,
        must_change_password=True,
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    session.flush()
    add_audit_log(
        session,
        request=request,
        action="admin.user_create",
        user_id=current_admin.id,
        detail={"target_user_id": user.id, "target_username": user.username, "role": user.role},
    )
    session.commit()
    session.refresh(user)
    return user


@router.put("/users/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    request: Request,
    session: Session = Depends(get_session),
    current_admin: User = Depends(require_admin),
) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if user.id == current_admin.id and payload.is_active is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能禁用当前登录管理员")

    changes: dict[str, object] = {}
    if payload.nickname is not None:
        user.nickname = payload.nickname.strip()
        changes["nickname"] = user.nickname
    if payload.role is not None:
        user.role = payload.role
        changes["role"] = user.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
        changes["is_active"] = user.is_active
    user.updated_at = utc_now()

    add_audit_log(
        session,
        request=request,
        action="admin.user_update",
        user_id=current_admin.id,
        detail={"target_user_id": user.id, "target_username": user.username, "changes": changes},
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@router.post("/users/{user_id}/reset-password", response_model=UserRead)
def reset_password(
    user_id: int,
    payload: ResetPasswordRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_admin: User = Depends(require_admin),
) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    validate_password_strength(payload.new_password)

    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = True
    user.updated_at = utc_now()
    add_audit_log(
        session,
        request=request,
        action="admin.user_reset_password",
        user_id=current_admin.id,
        detail={"target_user_id": user.id, "target_username": user.username},
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@router.post("/users/{user_id}/disable", response_model=UserRead)
def disable_user(
    user_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_admin: User = Depends(require_admin),
) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if user.id == current_admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能禁用当前登录管理员")

    user.is_active = False
    user.updated_at = utc_now()
    add_audit_log(
        session,
        request=request,
        action="admin.user_disable",
        user_id=current_admin.id,
        detail={"target_user_id": user.id, "target_username": user.username},
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@router.post("/users/{user_id}/enable", response_model=UserRead)
def enable_user(
    user_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_admin: User = Depends(require_admin),
) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    user.is_active = True
    user.updated_at = utc_now()
    add_audit_log(
        session,
        request=request,
        action="admin.user_enable",
        user_id=current_admin.id,
        detail={"target_user_id": user.id, "target_username": user.username},
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user

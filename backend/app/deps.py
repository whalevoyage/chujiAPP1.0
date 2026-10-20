from fastapi import Depends, HTTPException, Request, status
from sqlmodel import Session, select

from app.config import get_settings
from app.database import get_session
from app.models import User
from app.security import verify_session_token


def get_current_user(
    request: Request,
    session: Session = Depends(get_session),
) -> User:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录")

    user_id = verify_session_token(token)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="会话无效或已过期")

    user = session.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不可用")

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user


def get_user_by_username(session: Session, username: str) -> User | None:
    normalized = username.strip()
    return session.exec(select(User).where(User.username == normalized)).first()

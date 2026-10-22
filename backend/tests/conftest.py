from collections.abc import Iterator

import pytest
from fastapi import Depends, HTTPException, Request, status
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.database import get_session
from app.deps import get_current_user
from app.main import app
from app.models import User
from app.security import hash_password


@pytest.fixture
def test_engine() -> Iterator:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all(
            [
                User(
                    id=1,
                    username="admin",
                    nickname="Admin",
                    password_hash=hash_password("Admin-test-123!"),
                    role="admin",
                    is_active=True,
                ),
                User(
                    id=2,
                    username="student-a",
                    nickname="Student A",
                    password_hash=hash_password("User-test-123!"),
                    role="user",
                    is_active=True,
                ),
                User(
                    id=3,
                    username="student-b",
                    nickname="Student B",
                    password_hash=hash_password("User-test-456!"),
                    role="user",
                    is_active=True,
                ),
            ]
        )
        session.commit()

    yield engine
    engine.dispose()


@pytest.fixture
def client(test_engine) -> Iterator[TestClient]:
    def override_session() -> Iterator[Session]:
        with Session(test_engine) as session:
            yield session

    def override_current_user(
        request: Request,
        session: Session = Depends(get_session),
    ) -> User:
        raw_user_id = request.headers.get("x-test-user-id", "2")
        try:
            user_id = int(raw_user_id)
        except ValueError as error:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED) from error
        user = session.get(User, user_id)
        if user is None or not user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
        return user

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_current_user] = override_current_user
    test_client = TestClient(app)
    try:
        yield test_client
    finally:
        app.dependency_overrides.clear()
        test_client.close()


@pytest.fixture
def user_headers() -> dict[str, str]:
    return {"x-test-user-id": "2"}


@pytest.fixture
def admin_headers() -> dict[str, str]:
    return {"x-test-user-id": "1"}

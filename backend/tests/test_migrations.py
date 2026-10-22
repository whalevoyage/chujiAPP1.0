import sqlite3
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel, select

from app import database
from app.models import DailyPlan, PlanStep, User


def setup_database_paths(monkeypatch, root: Path, engine) -> None:
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "project_path", lambda *parts: root.joinpath(*parts))
    monkeypatch.setattr(
        database,
        "get_settings",
        lambda: SimpleNamespace(initial_admin_username="admin", initial_admin_password="Safe-initial-123!"),
    )


def test_existing_sqlite_database_is_backed_up_then_stamped_once(tmp_path: Path, monkeypatch):
    database_path = tmp_path / "data" / "personal_vault.db"
    database_path.parent.mkdir(parents=True)
    engine = create_engine(f"sqlite:///{database_path.as_posix()}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(
            User(
                id=7,
                username="admin",
                nickname="admin",
                password_hash="existing-hash",
                role="admin",
                is_active=True,
            )
        )
        session.commit()
    setup_database_paths(monkeypatch, tmp_path, engine)

    database.init_db()
    with Session(engine) as session:
        restored_user = session.exec(select(User).where(User.id == 7)).one()
        assert restored_user.nickname == "admin"
    backup_files = list((tmp_path / "backups").glob("pre-alembic-baseline-*.sqlite"))
    assert len(backup_files) == 1
    with closing(sqlite3.connect(backup_files[0])) as connection:
        assert connection.execute("SELECT username FROM users WHERE id = 7").fetchone() == ("admin",)
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() == "8f9932e71f51"

    database.init_db()
    assert len(list((tmp_path / "backups").glob("pre-alembic-baseline-*.sqlite"))) == 1
    engine.dispose()


def test_empty_database_is_created_by_the_alembic_baseline(tmp_path: Path, monkeypatch):
    database_path = tmp_path / "data" / "personal_vault.db"
    database_path.parent.mkdir(parents=True)
    engine = create_engine(f"sqlite:///{database_path.as_posix()}", connect_args={"check_same_thread": False})
    setup_database_paths(monkeypatch, tmp_path, engine)

    database.init_db()

    with engine.connect() as connection:
        tables = {
            row[0]
            for row in connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'").all()
        }
        assert "alembic_version" in tables
        assert "users" in tables
        assert "daily_plans" in tables
        assert connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() == "8f9932e71f51"
    assert not list((tmp_path / "backups").glob("pre-alembic-baseline-*.sqlite"))
    engine.dispose()


def test_failed_alembic_upgrade_restores_the_database_snapshot(tmp_path: Path, monkeypatch):
    database_path = tmp_path / "data" / "personal_vault.db"
    database_path.parent.mkdir(parents=True)
    engine = create_engine(f"sqlite:///{database_path.as_posix()}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(
            User(
                id=9,
                username="admin",
                nickname="admin",
                password_hash="existing-hash",
                role="admin",
                is_active=True,
            )
        )
        session.commit()
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO alembic_version(version_num) VALUES ('legacy-revision')")
    setup_database_paths(monkeypatch, tmp_path, engine)

    def fail_upgrade(*_args, **_kwargs):
        raise RuntimeError("migration failed")

    monkeypatch.setattr(database.command, "upgrade", fail_upgrade)

    try:
        database._upgrade_database_schema()
    except RuntimeError as error:
        assert str(error) == "migration failed"
    else:
        raise AssertionError("the injected migration failure should propagate")

    with Session(engine) as session:
        assert session.get(User, 9).password_hash == "existing-hash"
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() == "legacy-revision"
    assert len(list((tmp_path / "backups").glob("pre-alembic-upgrade-*.sqlite"))) == 1
    engine.dispose()


def test_legacy_schema_adds_missing_columns_without_losing_rows(tmp_path: Path, monkeypatch):
    database_path = tmp_path / "data" / "personal_vault.db"
    database_path.parent.mkdir(parents=True)
    engine = create_engine(f"sqlite:///{database_path.as_posix()}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(
            DailyPlan(
                id=12,
                user_id=4,
                plan_date="2026-10-21",
                title="Keep this plan",
                status="active",
            )
        )
        session.add(
            PlanStep(
                id=34,
                user_id=4,
                plan_id=12,
                title="Keep this step",
                start_time="09:00",
                end_time="10:00",
            )
        )
        session.commit()
    with engine.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE plan_steps DROP COLUMN enable_reminder")
    setup_database_paths(monkeypatch, tmp_path, engine)

    database.init_db()

    with Session(engine) as session:
        assert session.get(DailyPlan, 12).title == "Keep this plan"
        step = session.get(PlanStep, 34)
        assert step.title == "Keep this step"
        assert step.enable_reminder is False
    engine.dispose()

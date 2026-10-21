from collections.abc import Generator
from contextlib import closing
from datetime import UTC, datetime
import logging
import os
from pathlib import Path
import sqlite3

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine, select

from app.config import get_settings, project_path
from app.models import User, utc_now
from app.security import hash_password

logger = logging.getLogger("chuji.database")


def build_sqlite_url() -> str:
    db_path = project_path("data", "personal_vault.db")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{db_path.as_posix()}"


engine: Engine = create_engine(
    build_sqlite_url(),
    connect_args={"check_same_thread": False},
)


def init_db() -> None:
    project_path("data", "attachments").mkdir(parents=True, exist_ok=True)
    project_path("data", "exports").mkdir(parents=True, exist_ok=True)
    project_path("backups").mkdir(parents=True, exist_ok=True)
    project_path("logs").mkdir(parents=True, exist_ok=True)
    _upgrade_database_schema()
    ensure_initial_admin()


def _alembic_config() -> Config:
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    config.set_main_option("sqlalchemy.url", engine.url.render_as_string(hide_password=False).replace("%", "%%"))
    return config


def _user_tables() -> set[str]:
    with engine.connect() as connection:
        return {
            str(row[0])
            for row in connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'").all()
            if not str(row[0]).startswith("sqlite_")
        }


def _alembic_revision_present() -> bool:
    if "alembic_version" not in _user_tables():
        return False
    with engine.connect() as connection:
        return connection.exec_driver_sql("SELECT 1 FROM alembic_version LIMIT 1").first() is not None


def _backup_legacy_database(prefix: str = "pre-alembic-baseline") -> Path | None:
    database_path = engine.url.database
    if not database_path or database_path == ":memory:":
        return None
    source_path = Path(database_path)
    if not source_path.exists():
        return None
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    backup_path = project_path("backups", f"{prefix}-{timestamp}.sqlite")
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with closing(sqlite3.connect(source_path)) as source, closing(sqlite3.connect(backup_path)) as destination:
            source.backup(destination)
    except Exception:
        backup_path.unlink(missing_ok=True)
        raise
    return backup_path


def _restore_legacy_database(backup_path: Path, database_path: str) -> None:
    engine.dispose()
    target_path = Path(database_path)
    temporary_path = target_path.with_name(f".{target_path.name}.rollback.tmp")
    temporary_path.unlink(missing_ok=True)
    for suffix in ("-wal", "-shm"):
        Path(f"{target_path}{suffix}").unlink(missing_ok=True)
    with closing(sqlite3.connect(backup_path)) as source, closing(sqlite3.connect(temporary_path)) as destination:
        source.backup(destination)
    os.replace(temporary_path, target_path)


def _ensure_legacy_schema() -> None:
    ensure_plan_task_schema()
    ensure_diary_schema()
    ensure_review_schema()
    ensure_honor_attachment_schema()
    ensure_backup_schema()
    ensure_course_schema()
    ensure_focus_score_schema()
    ensure_memory_schema()
    ensure_project_schema()
    ensure_user_weather_schema()


def _upgrade_database_schema() -> None:
    config = _alembic_config()
    tables = _user_tables()
    if _alembic_revision_present():
        current_revisions = _stored_alembic_revisions()
        current_head = ScriptDirectory.from_config(config).get_current_head()
        if current_revisions == ([current_head] if current_head else []):
            return
        logger.info("database migration started from=%s to=%s", current_revisions, current_head)
        database_path = engine.url.database
        backup_path = _backup_legacy_database("pre-alembic-upgrade")
        if backup_path:
            logger.info("database migration recovery copy created filename=%s", backup_path.name)
        try:
            command.upgrade(config, "head")
        except Exception:
            if backup_path and database_path:
                _restore_legacy_database(backup_path, database_path)
                logger.error("database migration failed and recovery copy was restored")
            raise
        logger.info("database migration completed revision=%s", current_head)
        return
    if not tables:
        command.upgrade(config, "head")
        return

    # Existing SQLite files are normalized with the legacy additive migration
    # helpers only once, after a consistent SQLite backup, then stamped to the
    # baseline so all future schema changes go through Alembic revisions.
    database_path = engine.url.database
    backup_path = _backup_legacy_database()
    if backup_path:
        logger.info("legacy database baseline copy created filename=%s", backup_path.name)
    try:
        SQLModel.metadata.create_all(engine)
        _ensure_legacy_schema()
        command.stamp(config, "head")
        logger.info("legacy database was stamped to current Alembic baseline")
    except Exception:
        if backup_path and database_path:
            _restore_legacy_database(backup_path, database_path)
            logger.error("legacy database baseline failed and recovery copy was restored")
        raise


def _stored_alembic_revisions() -> list[str]:
    with engine.connect() as connection:
        return sorted(str(row[0]) for row in connection.exec_driver_sql("SELECT version_num FROM alembic_version").all())


def ensure_plan_task_schema() -> None:
    columns_by_table = {
        "daily_plans": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "plan_date": "VARCHAR(10)",
            "title": "VARCHAR(200)",
            "main_goal": "VARCHAR(500)",
            "note": "TEXT",
            "status": "VARCHAR(20) NOT NULL DEFAULT 'active'",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "plan_steps": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "plan_id": "INTEGER",
            "title": "VARCHAR(200)",
            "description": "VARCHAR(500)",
            "start_time": "VARCHAR(5)",
            "end_time": "VARCHAR(5)",
            "remind_time": "VARCHAR(5)",
            "remind_before_minutes": "INTEGER",
            "priority": "INTEGER NOT NULL DEFAULT 0",
            "status": "VARCHAR(20) NOT NULL DEFAULT 'pending'",
            "enable_reminder": "BOOLEAN NOT NULL DEFAULT 0",
            "linked_task_id": "INTEGER",
            "completed_at": "DATETIME",
            "delay_reason": "VARCHAR(500)",
            "skip_reason": "VARCHAR(500)",
            "sort_order": "INTEGER NOT NULL DEFAULT 0",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "tasks": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "title": "VARCHAR(200)",
            "category": "VARCHAR(100)",
            "task_type": "VARCHAR(50)",
            "frequency": "VARCHAR(50)",
            "priority": "INTEGER NOT NULL DEFAULT 0",
            "weight": "FLOAT",
            "estimated_minutes": "INTEGER",
            "is_active": "BOOLEAN NOT NULL DEFAULT 1",
            "sort_order": "INTEGER NOT NULL DEFAULT 0",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "task_logs": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "task_id": "INTEGER",
            "log_date": "VARCHAR(10)",
            "status": "VARCHAR(20) NOT NULL DEFAULT 'completed'",
            "note": "VARCHAR(500)",
            "minutes": "INTEGER",
            "difficulty": "INTEGER",
            "is_makeup": "BOOLEAN NOT NULL DEFAULT 0",
            "makeup_reason": "VARCHAR(500)",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
    }

    now = utc_now().isoformat()
    with engine.begin() as connection:
        existing_tables = {
            row[0]
            for row in connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        for table_name, columns in columns_by_table.items():
            if table_name not in existing_tables:
                continue
            existing_columns = {
                row[1]
                for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})")
            }
            for column_name, ddl in columns.items():
                if column_name in existing_columns or column_name == "id":
                    continue
                connection.exec_driver_sql(
                    f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}"
                )
            for timestamp_column in ("created_at", "updated_at"):
                if timestamp_column in columns:
                    connection.execute(
                        text(
                            f"UPDATE {table_name} "
                            f"SET {timestamp_column} = :now "
                            f"WHERE {timestamp_column} IS NULL"
                        ),
                        {"now": now},
                    )


def ensure_diary_schema() -> None:
    columns_by_table = {
        "diary_entries": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "title": "VARCHAR(200)",
            "content_md": "TEXT",
            "mood": "VARCHAR(50)",
            "entry_date": "VARCHAR(10)",
            "is_starred": "BOOLEAN NOT NULL DEFAULT 0",
            "is_private": "BOOLEAN NOT NULL DEFAULT 0",
            "is_deleted": "BOOLEAN NOT NULL DEFAULT 0",
            "deleted_at": "DATETIME",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "tags": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "name": "VARCHAR(50)",
            "color": "VARCHAR(7)",
            "created_at": "DATETIME",
        },
        "tag_links": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "tag_id": "INTEGER",
            "target_type": "VARCHAR(50)",
            "target_id": "INTEGER",
        },
    }

    now = utc_now().isoformat()
    with engine.begin() as connection:
        existing_tables = {
            row[0]
            for row in connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        for table_name, columns in columns_by_table.items():
            if table_name not in existing_tables:
                continue
            existing_columns = {
                row[1]
                for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})")
            }
            for column_name, ddl in columns.items():
                if column_name in existing_columns or column_name == "id":
                    continue
                connection.exec_driver_sql(
                    f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}"
                )
            for timestamp_column in ("created_at", "updated_at"):
                if timestamp_column in columns:
                    connection.execute(
                        text(
                            f"UPDATE {table_name} "
                            f"SET {timestamp_column} = :now "
                            f"WHERE {timestamp_column} IS NULL"
                        ),
                        {"now": now},
                    )


def ensure_review_schema() -> None:
    columns_by_table = {
        "weakness_records": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "title": "VARCHAR(200)",
            "category": "VARCHAR(50) NOT NULL DEFAULT '其他'",
            "severity": "INTEGER NOT NULL DEFAULT 5",
            "occur_date": "VARCHAR(10)",
            "occur_period": "VARCHAR(20)",
            "behavior": "TEXT",
            "reason": "TEXT",
            "impact": "TEXT",
            "emotion": "VARCHAR(100)",
            "correction": "TEXT",
            "prevention": "TEXT",
            "is_resolved": "BOOLEAN NOT NULL DEFAULT 0",
            "review_count": "INTEGER NOT NULL DEFAULT 0",
            "is_deleted": "BOOLEAN NOT NULL DEFAULT 0",
            "deleted_at": "DATETIME",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "improvement_actions": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "weakness_id": "INTEGER",
            "title": "VARCHAR(200)",
            "description": "TEXT",
            "difficulty": "INTEGER NOT NULL DEFAULT 5",
            "estimated_minutes": "INTEGER",
            "add_to_plan": "BOOLEAN NOT NULL DEFAULT 0",
            "add_to_task": "BOOLEAN NOT NULL DEFAULT 0",
            "status": "VARCHAR(20) NOT NULL DEFAULT '未执行'",
            "feedback": "TEXT",
            "completed_at": "DATETIME",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "review_reports": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "report_type": "VARCHAR(20)",
            "start_date": "VARCHAR(10)",
            "end_date": "VARCHAR(10)",
            "input_summary": "TEXT",
            "ai_prompt": "TEXT",
            "ai_response": "TEXT",
            "final_content": "TEXT",
            "accepted": "BOOLEAN NOT NULL DEFAULT 0",
            "next_actions": "TEXT",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
    }

    now = utc_now().isoformat()
    with engine.begin() as connection:
        existing_tables = {
            row[0]
            for row in connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        for table_name, columns in columns_by_table.items():
            if table_name not in existing_tables:
                continue
            existing_columns = {
                row[1]
                for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})")
            }
            for column_name, ddl in columns.items():
                if column_name in existing_columns or column_name == "id":
                    continue
                connection.exec_driver_sql(
                    f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}"
                )
            for timestamp_column in ("created_at", "updated_at"):
                if timestamp_column in columns:
                    connection.execute(
                        text(
                            f"UPDATE {table_name} "
                            f"SET {timestamp_column} = :now "
                            f"WHERE {timestamp_column} IS NULL"
                        ),
                        {"now": now},
                    )


def ensure_honor_attachment_schema() -> None:
    columns_by_table = {
        "honors": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "title": "VARCHAR(200)",
            "honor_type": "VARCHAR(100)",
            "level": "VARCHAR(100)",
            "issuer": "VARCHAR(200)",
            "award_date": "VARCHAR(10)",
            "role": "VARCHAR(200)",
            "weight": "INTEGER NOT NULL DEFAULT 5",
            "resume_ready": "BOOLEAN NOT NULL DEFAULT 0",
            "is_featured": "BOOLEAN NOT NULL DEFAULT 0",
            "description": "TEXT",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "attachments": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "owner_type": "VARCHAR(50)",
            "owner_id": "INTEGER",
            "filename": "VARCHAR(255)",
            "stored_path": "TEXT",
            "mime_type": "VARCHAR(120)",
            "size": "INTEGER NOT NULL DEFAULT 0",
            "sha256": "VARCHAR(64)",
            "created_at": "DATETIME",
        },
    }

    now = utc_now().isoformat()
    with engine.begin() as connection:
        existing_tables = {
            row[0]
            for row in connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        for table_name, columns in columns_by_table.items():
            if table_name not in existing_tables:
                continue
            existing_columns = {
                row[1]
                for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})")
            }
            for column_name, ddl in columns.items():
                if column_name in existing_columns or column_name == "id":
                    continue
                connection.exec_driver_sql(
                    f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}"
                )
            for timestamp_column in ("created_at", "updated_at"):
                if timestamp_column in columns:
                    connection.execute(
                        text(
                            f"UPDATE {table_name} "
                            f"SET {timestamp_column} = :now "
                            f"WHERE {timestamp_column} IS NULL"
                        ),
                        {"now": now},
                    )


def ensure_backup_schema() -> None:
    columns_by_table = {
        "backup_records": {
            "id": "INTEGER",
            "created_by_user_id": "INTEGER NOT NULL DEFAULT 0",
            "file_path": "TEXT",
            "size": "INTEGER NOT NULL DEFAULT 0",
            "sha256": "VARCHAR(64)",
            "status": "VARCHAR(20) NOT NULL DEFAULT 'success'",
            "created_at": "DATETIME",
            "error_message": "TEXT",
        },
    }

    now = utc_now().isoformat()
    with engine.begin() as connection:
        existing_tables = {
            row[0]
            for row in connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        for table_name, columns in columns_by_table.items():
            if table_name not in existing_tables:
                continue
            existing_columns = {
                row[1]
                for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})")
            }
            for column_name, ddl in columns.items():
                if column_name in existing_columns or column_name == "id":
                    continue
                connection.exec_driver_sql(
                    f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}"
                )
            connection.execute(
                text(
                    f"UPDATE {table_name} "
                    "SET status = 'success' "
                    "WHERE status = 'completed'"
                )
            )
            connection.execute(
                text(
                    f"UPDATE {table_name} "
                    "SET created_at = :now "
                    "WHERE created_at IS NULL"
                ),
                {"now": now},
            )


def ensure_course_schema() -> None:
    columns_by_table = {
        "courses": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "name": "VARCHAR(200)",
            "teacher": "VARCHAR(100)",
            "location": "VARCHAR(200)",
            "day_of_week": "INTEGER NOT NULL DEFAULT 0",
            "start_time": "VARCHAR(5)",
            "end_time": "VARCHAR(5)",
            "start_week": "INTEGER DEFAULT 1",
            "end_week": "INTEGER DEFAULT 16",
            "color": "VARCHAR(20)",
            "note": "TEXT",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
    }

    now = utc_now().isoformat()
    with engine.begin() as connection:
        existing_tables = {
            row[0]
            for row in connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")
        }
        for table_name, columns in columns_by_table.items():
            if table_name not in existing_tables:
                continue
            existing_columns = {
                row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})")
            }
            for column_name, ddl in columns.items():
                if column_name in existing_columns or column_name == "id":
                    continue
                connection.exec_driver_sql(
                    f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}"
                )
            for timestamp_column in ("created_at", "updated_at"):
                if timestamp_column in columns:
                    connection.execute(
                        text(
                            f"UPDATE {table_name} SET {timestamp_column} = :now WHERE {timestamp_column} IS NULL"
                        ),
                        {"now": now},
                    )


def ensure_focus_score_schema() -> None:
    columns_by_table = {
        "focus_sessions": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "label": "VARCHAR(200)",
            "status": "VARCHAR(20) NOT NULL DEFAULT 'running'",
            "planned_minutes": "INTEGER NOT NULL DEFAULT 25",
            "duration_seconds": "INTEGER NOT NULL DEFAULT 0",
            "started_at": "DATETIME",
            "ended_at": "DATETIME",
            "created_at": "DATETIME",
        },
        "daily_scores": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "score_date": "VARCHAR(10)",
            "score": "INTEGER NOT NULL DEFAULT 3",
            "note": "VARCHAR(500)",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "daily_reminders": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "reminder_date": "VARCHAR(10)",
            "text": "VARCHAR(500)",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
        "score_cards": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "title": "VARCHAR(200)",
            "semester": "VARCHAR(50)",
            "subjects_json": "TEXT",
            "total_score": "FLOAT",
            "gpa": "FLOAT",
            "note": "TEXT",
            "ai_analysis": "TEXT",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
    }
    now = utc_now().isoformat()
    with engine.begin() as connection:
        existing_tables = {
            row[0]
            for row in connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")
        }
        for table_name, columns in columns_by_table.items():
            if table_name not in existing_tables:
                continue
            existing_columns = {
                row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})")
            }
            for column_name, ddl in columns.items():
                if column_name in existing_columns or column_name == "id":
                    continue
                connection.exec_driver_sql(
                    f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}"
                )
            for timestamp_column in ("created_at", "updated_at"):
                if timestamp_column in columns:
                    connection.execute(
                        text(
                            f"UPDATE {table_name} SET {timestamp_column} = :now WHERE {timestamp_column} IS NULL"
                        ),
                        {"now": now},
                    )


def ensure_memory_schema() -> None:
    columns_by_table = {
        "memories": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "title": "VARCHAR(200)",
            "photo_date": "VARCHAR(10)",
            "location": "VARCHAR(200)",
            "story": "TEXT",
            "tags": "VARCHAR(500)",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
    }
    now = utc_now().isoformat()
    with engine.begin() as connection:
        existing_tables = {row[0] for row in connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")}
        for table_name, columns in columns_by_table.items():
            if table_name not in existing_tables:
                continue
            existing_columns = {row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})")}
            for column_name, ddl in columns.items():
                if column_name in existing_columns or column_name == "id":
                    continue
                connection.exec_driver_sql(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}")
            for ts_col in ("created_at", "updated_at"):
                if ts_col in columns:
                    connection.execute(text(f"UPDATE {table_name} SET {ts_col} = :now WHERE {ts_col} IS NULL"), {"now": now})


def ensure_project_schema() -> None:
    columns_by_table = {
        "projects": {
            "id": "INTEGER",
            "user_id": "INTEGER NOT NULL DEFAULT 0",
            "name": "VARCHAR(200)",
            "project_type": "VARCHAR(100)",
            "start_date": "VARCHAR(10)",
            "status": "VARCHAR(20) NOT NULL DEFAULT '进行中'",
            "tech_stack": "VARCHAR(500)",
            "summary": "TEXT",
            "link": "VARCHAR(500)",
            "achievements": "TEXT",
            "next_plan": "TEXT",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
    }
    now = utc_now().isoformat()
    with engine.begin() as connection:
        existing_tables = {row[0] for row in connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")}
        for table_name, columns in columns_by_table.items():
            if table_name not in existing_tables:
                continue
            existing_columns = {row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})")}
            for column_name, ddl in columns.items():
                if column_name in existing_columns or column_name == "id":
                    continue
                connection.exec_driver_sql(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}")
            for ts_col in ("created_at", "updated_at"):
                if ts_col in columns:
                    connection.execute(text(f"UPDATE {table_name} SET {ts_col} = :now WHERE {ts_col} IS NULL"), {"now": now})


def ensure_user_weather_schema() -> None:
    """为 users 表增加天气地区偏好字段。"""
    columns_by_table = {
        "users": {
            "weather_location_id": "VARCHAR(20)",
            "weather_location_name": "VARCHAR(100)",
            "weather_location_adm1": "VARCHAR(100)",
            "weather_location_adm2": "VARCHAR(100)",
        },
    }
    with engine.begin() as connection:
        for table_name, columns in columns_by_table.items():
            result = connection.exec_driver_sql(
                f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}'"
            )
            if not result.fetchone():
                continue
            col_result = connection.exec_driver_sql(f"PRAGMA table_info({table_name})")
            existing_columns = {row[1] for row in col_result.fetchall()}
            for column_name, ddl in columns.items():
                if column_name in existing_columns or column_name == "id":
                    continue
                connection.exec_driver_sql(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}")


def ensure_initial_admin() -> None:
    settings = get_settings()
    with Session(engine) as session:
        target_username = settings.initial_admin_username.strip() or "admin"
        target_user = session.exec(select(User).where(User.username == target_username)).first()
        legacy_admin = session.exec(
            select(User).where(User.username == "admin", User.role == "admin")
        ).first()
        if legacy_admin is not None and target_user is None:
            legacy_admin.username = target_username
            legacy_admin.nickname = target_username
            legacy_admin.updated_at = utc_now()
            session.add(legacy_admin)
            session.commit()
        elif target_user is not None and target_user.role == "admin" and target_user.nickname != target_username:
            target_user.nickname = target_username
            target_user.updated_at = utc_now()
            session.add(target_user)
            session.commit()

        existing_user = session.exec(select(User)).first()
        if existing_user is not None:
            return

        password = settings.initial_admin_password.strip()
        # 避免硬编码默认密码：未配置或使用已知弱密码时自动生成随机密码
        known_weak = {"", "admin", "password", "password123", "changeme123!"}
        if password.lower() in known_weak or len(password) < 12:
            import secrets as _secrets
            password = _secrets.token_urlsafe(16)
            print(f"\n[初记] 未检测到安全的初始管理员密码，已自动生成: {password}")
            print(f"      请在 .env 中设置 INITIAL_ADMIN_PASSWORD 或登录后修改密码\n")
            must_change = True
        else:
            must_change = False

        now = utc_now()
        admin = User(
            username=target_username,
            nickname=target_username,
            password_hash=hash_password(password),
            role="admin",
            is_active=True,
            must_change_password=must_change,
            created_at=now,
            updated_at=now,
        )
        session.add(admin)
        session.commit()


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session

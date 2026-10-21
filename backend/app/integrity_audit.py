"""Read-only audit of relationships that are candidates for database foreign keys."""

import json
from typing import Any

from sqlalchemy import Engine, inspect, text

from app.database import engine


RELATIONSHIPS = (
    ("plan_steps", "plan_id", "daily_plans", "id"),
    ("plan_steps", "linked_task_id", "tasks", "id"),
    ("task_logs", "task_id", "tasks", "id"),
    ("improvement_actions", "weakness_id", "weakness_records", "id"),
    ("tag_links", "tag_id", "tags", "id"),
    ("backup_records", "created_by_user_id", "users", "id"),
)
ATTACHMENT_OWNERS = (("honor", "honors"), ("memory", "memories"), ("project", "projects"))


def _orphan_count(connection, child: str, child_column: str, parent: str, parent_column: str) -> int | None:
    tables = set(inspect(connection).get_table_names())
    if child not in tables or parent not in tables:
        return None
    child_columns = {column["name"] for column in inspect(connection).get_columns(child)}
    parent_columns = {column["name"] for column in inspect(connection).get_columns(parent)}
    if child_column not in child_columns or parent_column not in parent_columns:
        return None
    statement = text(
        f"SELECT COUNT(*) FROM {child} AS child "
        f"WHERE child.{child_column} IS NOT NULL "
        f"AND NOT EXISTS (SELECT 1 FROM {parent} AS parent WHERE parent.{parent_column} = child.{child_column})"
    )
    return int(connection.execute(statement).scalar_one())


def audit_relationship_integrity(database_engine: Engine = engine) -> dict[str, Any]:
    """Return orphan counts without changing the database or exposing row contents."""
    orphan_counts: dict[str, int] = {}
    foreign_keys_enabled: bool | None = None
    with database_engine.connect() as connection:
        if database_engine.dialect.name == "sqlite":
            foreign_keys_enabled = bool(connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one())
        tables = set(inspect(connection).get_table_names())
        if "users" in tables:
            for table in sorted(tables - {"users", "alembic_version"}):
                columns = {column["name"] for column in inspect(connection).get_columns(table)}
                if "user_id" not in columns:
                    continue
                count = _orphan_count(connection, table, "user_id", "users", "id")
                if count:
                    orphan_counts[f"{table}.user_id -> users.id"] = count

        for child, child_column, parent, parent_column in RELATIONSHIPS:
            count = _orphan_count(connection, child, child_column, parent, parent_column)
            if count:
                orphan_counts[f"{child}.{child_column} -> {parent}.{parent_column}"] = count

        if "attachments" in tables:
            for owner_type, owner_table in ATTACHMENT_OWNERS:
                if owner_table not in tables:
                    continue
                count = connection.execute(
                    text(
                        "SELECT COUNT(*) FROM attachments AS attachment "
                        "WHERE attachment.owner_type = :owner_type "
                        f"AND NOT EXISTS (SELECT 1 FROM {owner_table} AS owner WHERE owner.id = attachment.owner_id)"
                    ),
                    {"owner_type": owner_type},
                ).scalar_one()
                if count:
                    orphan_counts[f"attachments.owner_id[{owner_type}] -> {owner_table}.id"] = int(count)

    return {
        "status": "clean" if not orphan_counts else "orphans_found",
        "orphan_counts": orphan_counts,
        "foreign_keys_enabled": foreign_keys_enabled,
        "note": "Read-only audit. A clean result is a prerequisite for, not an automatic application of, FK migrations.",
    }


if __name__ == "__main__":
    report = audit_relationship_integrity()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["status"] == "clean" else 1)

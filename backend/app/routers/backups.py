import hashlib
import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from app.audit import add_audit_log
from app.config import project_path
from app.database import engine, get_session, init_db
from app.deps import get_current_user
from app.models import (
    Attachment,
    BackupRecord,
    DailyPlan,
    DiaryEntry,
    Honor,
    ImprovementAction,
    PlanStep,
    ReviewReport,
    Task,
    TaskLog,
    User,
    WeaknessRecord,
    utc_now,
)
from app.routers.attachments import assert_delete_password
from app.schemas import BackupRecordRead, DeletePasswordRequest

router = APIRouter(prefix="/api/backups", tags=["backups"])
exports_router = APIRouter(prefix="/api/exports", tags=["exports"])

PROJECT_ROOT = project_path().resolve()
DATA_DIR = project_path("data").resolve()
DB_PATH = project_path("data", "personal_vault.db").resolve()
ATTACHMENTS_DIR = project_path("data", "attachments").resolve()
EXPORTS_DIR = project_path("data", "exports").resolve()
BACKUPS_DIR = project_path("backups").resolve()
README_PATH = project_path("README.md").resolve()
NOTICE_PATH = project_path("NOTICE.md").resolve()

MANIFEST_NAME = "backup_manifest.json"
MANIFEST_SOURCE = "personal_vault"
MANIFEST_VERSION = 1
ALLOWED_ZIP_TOP_LEVEL = {"data", "README.md", "NOTICE.md", MANIFEST_NAME}


def ensure_storage_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def backup_filename(prefix: str) -> str:
    timestamp = utc_now().strftime("%Y%m%d_%H%M%S_%f")
    return f"{prefix}_{timestamp}.zip"


def add_directory_to_zip(zip_file: zipfile.ZipFile, directory: Path, archive_root: str) -> None:
    zip_file.writestr(f"{archive_root}/", "")
    if not directory.exists():
        return
    root = directory.resolve()
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        resolved = path.resolve()
        if not resolved.is_relative_to(root):
            continue
        archive_name = PurePosixPath(archive_root) / resolved.relative_to(root).as_posix()
        zip_file.write(resolved, archive_name.as_posix())


def write_backup_archive(path: Path, *, created_by_user_id: int, backup_kind: str) -> tuple[int, str]:
    ensure_storage_dirs()
    manifest = {
        "source": MANIFEST_SOURCE,
        "format_version": MANIFEST_VERSION,
        "backup_kind": backup_kind,
        "created_at": utc_now().isoformat(),
        "created_by_user_id": created_by_user_id,
        "includes": [
            "data/personal_vault.db",
            "data/attachments",
            "data/exports",
            "README.md",
            "NOTICE.md",
        ],
    }

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zip_file:
        if DB_PATH.exists():
            zip_file.write(DB_PATH, "data/personal_vault.db")
        add_directory_to_zip(zip_file, ATTACHMENTS_DIR, "data/attachments")
        if EXPORTS_DIR.exists():
            add_directory_to_zip(zip_file, EXPORTS_DIR, "data/exports")
        if README_PATH.exists():
            zip_file.write(README_PATH, "README.md")
        if NOTICE_PATH.exists():
            zip_file.write(NOTICE_PATH, "NOTICE.md")
        zip_file.writestr(
            MANIFEST_NAME,
            json.dumps(manifest, ensure_ascii=False, indent=2, default=str),
        )

    return path.stat().st_size, sha256_file(path)


def record_backup(
    session: Session,
    *,
    user_id: int,
    path: Path,
    size: int,
    sha256: str,
    status_value: str,
    error_message: str | None = None,
) -> BackupRecord:
    record = BackupRecord(
        created_by_user_id=user_id,
        file_path=str(path),
        size=size,
        sha256=sha256,
        status=status_value,
        created_at=utc_now(),
        error_message=error_message,
    )
    session.add(record)
    session.flush()
    return record


def backup_response(record: BackupRecord) -> BackupRecordRead:
    return BackupRecordRead(
        id=record.id or 0,
        created_by_user_id=record.created_by_user_id,
        filename=Path(record.file_path).name if record.file_path else "",
        size=record.size,
        sha256=record.sha256,
        status=record.status,
        created_at=record.created_at,
        error_message=record.error_message,
    )


def safe_error_message(error: Exception) -> str:
    return str(error).strip()[:1000] or error.__class__.__name__


def is_auto_backup_record(record: BackupRecord) -> bool:
    filename = Path(record.file_path or "").name
    return filename.startswith(("auto_", "light_"))


def cleanup_auto_backups(session: Session, keep: int = 10) -> None:
    records = [
        record
        for record in session.exec(select(BackupRecord).order_by(BackupRecord.created_at.desc())).all()
        if is_auto_backup_record(record)
    ]
    for record in records[keep:]:
        try:
            path = resolve_backup_path(record)
            path.unlink(missing_ok=True)
        except Exception:
            pass
        session.delete(record)


def create_backup_record(
    session: Session,
    *,
    request: Request | None,
    user_id: int,
    prefix: str,
    backup_kind: str,
    action: str,
    cleanup_auto: bool = False,
) -> BackupRecord:
    path = BACKUPS_DIR / backup_filename(prefix)
    size, file_hash = write_backup_archive(path, created_by_user_id=user_id, backup_kind=backup_kind)
    record = record_backup(
        session,
        user_id=user_id,
        path=path,
        size=size,
        sha256=file_hash,
        status_value="success",
    )
    if request is not None:
        add_audit_log(
            session,
            request=request,
            action=action,
            user_id=user_id,
            detail={"backup_id": record.id, "filename": path.name, "size": size, "sha256": file_hash},
        )
    if cleanup_auto:
        cleanup_auto_backups(session)
    return record


def has_today_auto_backup(session: Session) -> bool:
    today_prefix = f"auto_{utc_now().strftime('%Y%m%d')}_"
    records = session.exec(select(BackupRecord).order_by(BackupRecord.created_at.desc())).all()
    for record in records:
        filename = Path(record.file_path or "").name
        if filename.startswith(today_prefix) and record.status in {"success", "restored"}:
            return True
    return False


def maybe_create_daily_auto_backup(session: Session, *, request: Request | None, user_id: int) -> BackupRecord | None:
    """Create one automatic backup per day. Failure never blocks login/opening."""
    try:
        ensure_storage_dirs()
        if has_today_auto_backup(session):
            return None
        record = create_backup_record(
            session,
            request=request,
            user_id=user_id,
            prefix="auto",
            backup_kind="daily-auto",
            action="backup.auto_daily",
            cleanup_auto=True,
        )
        session.commit()
        return record
    except Exception:
        session.rollback()
        return None


def trigger_light_backup(
    session: Session,
    user_id: int,
    *,
    request: Request | None = None,
    reason: str = "data-change",
) -> BackupRecord | None:
    """Create a lightweight full-data backup after important changes. Failure is silent."""
    try:
        record = create_backup_record(
            session,
            request=request,
            user_id=user_id,
            prefix="light",
            backup_kind=f"light-{reason}",
            action="backup.light",
            cleanup_auto=True,
        )
        session.commit()
        return record
    except Exception:
        session.rollback()
        return None


def resolve_backup_path(record: BackupRecord) -> Path:
    path = Path(record.file_path)
    if not path.is_absolute():
        path = BACKUPS_DIR / path
    resolved = path.resolve()
    if not resolved.is_relative_to(BACKUPS_DIR):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Backup path is not allowed")
    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup file not found")
    if resolved.suffix.lower() != ".zip" or not zipfile.is_zipfile(resolved):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Backup file is invalid")
    return resolved


def normalize_zip_member(filename: str) -> str:
    normalized = filename.replace("\\", "/").strip()
    path = PurePosixPath(normalized)
    parts = path.parts
    if (
        not normalized
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in parts)
        or any(":" in part for part in parts)
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Backup contains unsafe path")
    if parts[0] not in ALLOWED_ZIP_TOP_LEVEL:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Backup contains unexpected files")
    return path.as_posix()


def validate_backup_zip(path: Path) -> dict[str, Any]:
    names: set[str] = set()
    with zipfile.ZipFile(path, "r") as zip_file:
        for item in zip_file.infolist():
            names.add(normalize_zip_member(item.filename).rstrip("/"))
        if MANIFEST_NAME not in names:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Backup manifest is missing")
        if "data/personal_vault.db" not in names:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Backup database is missing")
        with zip_file.open(MANIFEST_NAME) as manifest_file:
            manifest = json.load(manifest_file)
    if manifest.get("source") != MANIFEST_SOURCE or manifest.get("format_version") != MANIFEST_VERSION:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Backup manifest is not trusted")
    return manifest


def extract_backup_safely(path: Path, destination: Path) -> None:
    root = destination.resolve()
    with zipfile.ZipFile(path, "r") as zip_file:
        for item in zip_file.infolist():
            member_name = normalize_zip_member(item.filename)
            target = (root / member_name).resolve()
            if not target.is_relative_to(root):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Backup contains unsafe path")
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zip_file.open(item, "r") as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)


def replace_directory(source: Path, target: Path, rollback_root: Path) -> Path:
    rollback = rollback_root / target.name
    if rollback.exists():
        shutil.rmtree(rollback)
    if target.exists():
        shutil.move(str(target), str(rollback))
    if source.exists():
        shutil.copytree(source, target)
    else:
        target.mkdir(parents=True, exist_ok=True)
    return rollback


def rollback_directory(target: Path, rollback: Path) -> None:
    if target.exists():
        shutil.rmtree(target)
    if rollback.exists():
        shutil.move(str(rollback), str(target))
    else:
        target.mkdir(parents=True, exist_ok=True)


def restore_files_from_extracted(extracted_root: Path) -> None:
    restored_data = extracted_root / "data"
    restored_db = restored_data / "personal_vault.db"
    restored_attachments = restored_data / "attachments"
    restored_exports = restored_data / "exports"
    if not restored_db.exists() or not restored_db.is_file():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Backup database is missing")

    with tempfile.TemporaryDirectory(prefix="restore-rollback-", dir=str(BACKUPS_DIR)) as rollback_dir_name:
        rollback_root = Path(rollback_dir_name)
        rollback_db = rollback_root / "personal_vault.db"
        attachment_rollback: Path | None = None
        exports_rollback: Path | None = None
        try:
            if DB_PATH.exists():
                shutil.copy2(DB_PATH, rollback_db)
            attachment_rollback = replace_directory(restored_attachments, ATTACHMENTS_DIR, rollback_root)
            exports_rollback = replace_directory(restored_exports, EXPORTS_DIR, rollback_root)
            shutil.copy2(restored_db, DB_PATH)
        except Exception:
            if rollback_db.exists():
                shutil.copy2(rollback_db, DB_PATH)
            if attachment_rollback is not None:
                rollback_directory(ATTACHMENTS_DIR, attachment_rollback)
            if exports_rollback is not None:
                rollback_directory(EXPORTS_DIR, exports_rollback)
            raise


def create_recovery_backup(session: Session, *, request: Request, user_id: int) -> BackupRecord:
    recovery_path = BACKUPS_DIR / backup_filename("recovery-before-backup")
    size, file_hash = write_backup_archive(
        recovery_path,
        created_by_user_id=user_id,
        backup_kind="recovery-before-restore",
    )
    record = record_backup(
        session,
        user_id=user_id,
        path=recovery_path,
        size=size,
        sha256=file_hash,
        status_value="success",
    )
    add_audit_log(
        session,
        request=request,
        action="backup.recovery_before_restore",
        user_id=user_id,
        detail={"backup_id": record.id, "filename": recovery_path.name, "size": size, "sha256": file_hash},
    )
    return record


def public_user(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "username": user.username,
        "nickname": user.nickname,
        "role": user.role,
        "is_active": user.is_active,
        "must_change_password": user.must_change_password,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
        "last_login_at": user.last_login_at,
    }


def rows_for_scope(session: Session, model: type[Any], user_ids: list[int] | None) -> list[Any]:
    statement = select(model)
    if user_ids is not None:
        if len(user_ids) == 1:
            statement = statement.where(model.user_id == user_ids[0])
        else:
            statement = statement.where(model.user_id.in_(user_ids))
    return list(session.exec(statement).all())


def row_dict(row: Any, *, exclude: set[str] | None = None) -> dict[str, Any]:
    data = row.model_dump()
    for key in exclude or set():
        data.pop(key, None)
    return data


def collect_export_data(session: Session, *, current_user: User, all_users: bool = False) -> dict[str, Any]:
    user_ids: list[int] | None = None
    if not all_users:
        user_ids = [current_user.id or 0]

    data: dict[str, Any] = {
        "exported_at": utc_now().isoformat(),
        "scope": "all_users" if all_users else "current_user",
        "current_user": public_user(current_user),
        "daily_plans": [row_dict(item) for item in rows_for_scope(session, DailyPlan, user_ids)],
        "plan_steps": [row_dict(item) for item in rows_for_scope(session, PlanStep, user_ids)],
        "tasks": [row_dict(item) for item in rows_for_scope(session, Task, user_ids)],
        "task_logs": [row_dict(item) for item in rows_for_scope(session, TaskLog, user_ids)],
        "diary_entries": [row_dict(item) for item in rows_for_scope(session, DiaryEntry, user_ids)],
        "weakness_records": [row_dict(item) for item in rows_for_scope(session, WeaknessRecord, user_ids)],
        "improvement_actions": [row_dict(item) for item in rows_for_scope(session, ImprovementAction, user_ids)],
        "review_reports": [row_dict(item) for item in rows_for_scope(session, ReviewReport, user_ids)],
        "honors": [row_dict(item) for item in rows_for_scope(session, Honor, user_ids)],
        "attachments": [
            row_dict(item, exclude={"stored_path"})
            for item in rows_for_scope(session, Attachment, user_ids)
        ],
    }
    if all_users:
        users = session.exec(select(User).order_by(User.id)).all()
        data["users"] = [public_user(user) for user in users]
    return data


def json_export_content(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, default=str)


def markdown_export_content(data: dict[str, Any]) -> str:
    lines = [
        "# 个人数据导出",
        "",
        f"- 导出时间：{data['exported_at']}",
        f"- 导出范围：{data['scope']}",
        f"- 用户：{data['current_user']['nickname']}（{data['current_user']['username']}）",
        "",
        "## 每日规划",
    ]
    plans = data["daily_plans"]
    steps = data["plan_steps"]
    if plans:
        for plan in plans:
            lines.append(f"### {plan.get('plan_date', '-')} {plan.get('title', '-')}")
            if plan.get("main_goal"):
                lines.append(f"- 主目标：{plan['main_goal']}")
            if plan.get("note"):
                lines.append(f"- 备注：{plan['note']}")
            plan_steps = [item for item in steps if item.get("plan_id") == plan.get("id")]
            for step in plan_steps:
                lines.append(
                    f"- {step.get('start_time', '--:--')}-{step.get('end_time', '--:--')} "
                    f"{step.get('title', '-')} [{step.get('status', '-')}]"
                )
            lines.append("")
    else:
        lines.append("暂无每日规划。")
        lines.append("")

    lines.append("## 任务打卡")
    tasks = data["tasks"]
    logs = data["task_logs"]
    if tasks:
        for task in tasks:
            task_logs = [item for item in logs if item.get("task_id") == task.get("id")]
            lines.append(f"### {task.get('title', '-')}")
            lines.append(f"- 类型：{task.get('task_type') or '-'}")
            lines.append(f"- 分类：{task.get('category') or '-'}")
            lines.append(f"- 打卡次数：{len(task_logs)}")
            for log in task_logs[:20]:
                lines.append(f"- {log.get('log_date', '-')} {log.get('status', '-')} {log.get('note') or ''}".rstrip())
            lines.append("")
    else:
        lines.append("暂无任务。")
        lines.append("")

    lines.append("## 日记")
    diaries = data["diary_entries"]
    if diaries:
        for diary in diaries:
            lines.append(f"### {diary.get('entry_date', '-')} {diary.get('title') or '无标题'}")
            if diary.get("mood"):
                lines.append(f"- 心情：{diary['mood']}")
            lines.append("")
            lines.append(str(diary.get("content_md") or ""))
            lines.append("")
    else:
        lines.append("暂无日记。")
        lines.append("")

    lines.append("## 缺点复盘")
    weaknesses = data["weakness_records"]
    actions = data["improvement_actions"]
    reports = data["review_reports"]
    if weaknesses:
        for weakness in weaknesses:
            lines.append(f"### {weakness.get('occur_date', '-')} {weakness.get('title') or '-'}")
            lines.append(f"- 分类：{weakness.get('category') or '-'}")
            lines.append(f"- 严重度：{weakness.get('severity')}")
            lines.append(f"- 行为：{weakness.get('behavior') or '-'}")
            related_actions = [item for item in actions if item.get("weakness_id") == weakness.get("id")]
            for action in related_actions:
                lines.append(f"- 改进动作：{action.get('title', '-')} [{action.get('status', '-')}]")
            lines.append("")
    else:
        lines.append("暂无缺点记录。")
        lines.append("")
    if reports:
        lines.append("### 复盘报告")
        for report in reports:
            lines.append(f"- {report.get('report_type', '-')} {report.get('start_date', '-')}-{report.get('end_date', '-')}")
        lines.append("")

    lines.append("## 荣誉墙")
    honors = data["honors"]
    attachments = data["attachments"]
    if honors:
        for honor in honors:
            honor_attachments = [
                item
                for item in attachments
                if item.get("owner_type") == "honor" and item.get("owner_id") == honor.get("id")
            ]
            lines.append(f"### {honor.get('title', '-')}")
            lines.append(f"- 类型：{honor.get('honor_type') or '-'}")
            lines.append(f"- 级别：{honor.get('level') or '-'}")
            lines.append(f"- 颁发方：{honor.get('issuer') or '-'}")
            lines.append(f"- 日期：{honor.get('award_date') or '-'}")
            lines.append(f"- 附件数量：{len(honor_attachments)}")
            for attachment in honor_attachments:
                lines.append(f"- 附件：{attachment.get('filename', '-')} ({attachment.get('size', 0)} bytes)")
            lines.append("")
    else:
        lines.append("暂无荣誉记录。")
        lines.append("")

    return "\n".join(lines)


def export_path(extension: str, *, user_id: int, scope: str) -> Path:
    ensure_storage_dirs()
    timestamp = utc_now().strftime("%Y%m%d_%H%M%S_%f")
    safe_scope = re.sub(r"[^A-Za-z0-9_-]", "_", scope)
    return EXPORTS_DIR / f"export_{safe_scope}_{user_id}_{timestamp}.{extension}"


def safe_filename(filename: str) -> str:
    name = Path(filename or "attachment").name.strip() or "attachment"
    return re.sub(r"[^A-Za-z0-9._\-\u4e00-\u9fff]", "_", name)[:180]


def safe_attachment_file(attachment: Attachment) -> Path | None:
    path = Path(attachment.stored_path)
    if not path.is_absolute():
        path = ATTACHMENTS_DIR / path
    resolved = path.resolve()
    if not resolved.is_relative_to(ATTACHMENTS_DIR):
        return None
    if not resolved.exists() or not resolved.is_file():
        return None
    return resolved


@router.post("/create", response_model=BackupRecordRead)
def create_backup(
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> BackupRecordRead:
    user_id = current_user.id or 0
    path = BACKUPS_DIR / backup_filename("backup")
    try:
        record = create_backup_record(
            session,
            request=request,
            user_id=user_id,
            prefix="backup",
            backup_kind="manual",
            action="backup.create",
        )
        session.commit()
        session.refresh(record)
        return backup_response(record)
    except Exception as error:
        session.rollback()
        message = safe_error_message(error)
        size = path.stat().st_size if path.exists() else 0
        file_hash = sha256_file(path) if path.exists() and path.is_file() else ""
        record = record_backup(
            session,
            user_id=user_id,
            path=path,
            size=size,
            sha256=file_hash,
            status_value="failed",
            error_message=message,
        )
        add_audit_log(
            session,
            request=request,
            action="backup.create_failed",
            user_id=user_id,
            detail={"backup_id": record.id, "filename": path.name, "error": message},
        )
        session.commit()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Backup failed") from error


@router.get("", response_model=list[BackupRecordRead])
def list_backups(
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[BackupRecordRead]:
    records = session.exec(select(BackupRecord).order_by(BackupRecord.created_at.desc())).all()
    add_audit_log(
        session,
        request=request,
        action="backup.list",
        user_id=current_user.id,
        detail={"count": len(records)},
    )
    session.commit()
    return [backup_response(record) for record in records]


@router.post("/auto-daily", response_model=BackupRecordRead | None)
def create_daily_auto_backup(
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> BackupRecordRead | None:
    record = maybe_create_daily_auto_backup(session, request=request, user_id=current_user.id or 0)
    if record is None:
        return None
    session.refresh(record)
    return backup_response(record)


@router.post("/light", response_model=BackupRecordRead | None)
def create_light_backup(
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> BackupRecordRead | None:
    record = trigger_light_backup(session, current_user.id or 0, request=request, reason="manual-light")
    if record is None:
        return None
    session.refresh(record)
    return backup_response(record)


@router.post("/{backup_id}/restore")
def restore_backup(
    backup_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = current_user.id or 0
    record = session.get(BackupRecord, backup_id)
    if record is None:
        add_audit_log(
            session,
            request=request,
            action="backup.restore_failed",
            user_id=user_id,
            detail={"backup_id": backup_id, "reason": "record_not_found"},
        )
        session.commit()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found")
    if record.status == "failed":
        add_audit_log(
            session,
            request=request,
            action="backup.restore_failed",
            user_id=user_id,
            detail={"backup_id": backup_id, "reason": "failed_backup_record"},
        )
        session.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed backup cannot be restored")

    try:
        backup_path = resolve_backup_path(record)
        actual_hash = sha256_file(backup_path)
        if actual_hash != record.sha256:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Backup sha256 mismatch")
        manifest = validate_backup_zip(backup_path)
        backup_size = record.size
        backup_hash = record.sha256
        recovery_record = create_recovery_backup(session, request=request, user_id=user_id)
        recovery_id = recovery_record.id
        recovery_path = Path(recovery_record.file_path)
        recovery_size = recovery_record.size
        recovery_hash = recovery_record.sha256
        session.commit()
    except HTTPException as error:
        session.rollback()
        add_audit_log(
            session,
            request=request,
            action="backup.restore_failed",
            user_id=user_id,
            detail={"backup_id": backup_id, "reason": error.detail},
        )
        session.commit()
        raise
    except Exception as error:
        session.rollback()
        message = safe_error_message(error)
        add_audit_log(
            session,
            request=request,
            action="backup.restore_failed",
            user_id=user_id,
            detail={"backup_id": backup_id, "reason": message},
        )
        session.commit()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Restore failed") from error

    with tempfile.TemporaryDirectory(prefix="restore-extract-", dir=str(BACKUPS_DIR)) as extract_dir_name:
        extract_root = Path(extract_dir_name)
        try:
            extract_backup_safely(backup_path, extract_root)
            session.close()
            engine.dispose()
            restore_files_from_extracted(extract_root)
            engine.dispose()
            init_db()
            with Session(engine) as restored_session:
                restored_backup = BackupRecord(
                    created_by_user_id=user_id,
                    file_path=str(backup_path),
                    size=backup_size,
                    sha256=backup_hash,
                    status="restored",
                    created_at=utc_now(),
                    error_message=None,
                )
                restored_session.add(restored_backup)
                restored_session.add(
                    BackupRecord(
                        created_by_user_id=user_id,
                        file_path=str(recovery_path),
                        size=recovery_size,
                        sha256=recovery_hash,
                        status="success",
                        created_at=utc_now(),
                        error_message=None,
                    )
                )
                add_audit_log(
                    restored_session,
                    request=request,
                    action="backup.restore",
                    user_id=user_id,
                    detail={
                        "backup_id": backup_id,
                        "filename": backup_path.name,
                        "manifest_kind": manifest.get("backup_kind"),
                        "recovery_backup_id": recovery_id,
                        "recovery_filename": recovery_path.name,
                    },
                )
                restored_session.commit()
        except HTTPException as error:
            engine.dispose()
            init_db()
            with Session(engine) as failure_session:
                add_audit_log(
                    failure_session,
                    request=request,
                    action="backup.restore_failed",
                    user_id=user_id,
                    detail={"backup_id": backup_id, "reason": error.detail, "recovery_filename": recovery_path.name},
                )
                failure_session.commit()
            raise
        except Exception as error:
            engine.dispose()
            init_db()
            message = safe_error_message(error)
            with Session(engine) as failure_session:
                add_audit_log(
                    failure_session,
                    request=request,
                    action="backup.restore_failed",
                    user_id=user_id,
                    detail={"backup_id": backup_id, "reason": message, "recovery_filename": recovery_path.name},
                )
                failure_session.commit()
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Restore failed") from error

    return {"ok": True, "recovery_backup": recovery_path.name}


@router.delete("/{backup_id}")
def delete_backup(
    backup_id: int,
    payload: DeletePasswordRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    assert_delete_password(payload)
    record = session.get(BackupRecord, backup_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found")
    filename = Path(record.file_path or "").name
    try:
        backup_path = resolve_backup_path(record)
        filename = backup_path.name
        backup_path.unlink(missing_ok=True)
    except HTTPException as error:
        if error.status_code not in {status.HTTP_404_NOT_FOUND, status.HTTP_400_BAD_REQUEST}:
            raise
    session.delete(record)
    add_audit_log(
        session,
        request=request,
        action="backup.delete",
        user_id=current_user.id,
        detail={"backup_id": backup_id, "filename": filename},
    )
    session.commit()
    return {"ok": True}


@exports_router.get("/json")
def export_json(
    request: Request,
    admin_all: bool = Query(default=False),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> FileResponse:
    user_id = current_user.id or 0
    if admin_all and current_user.role != "admin":
        add_audit_log(
            session,
            request=request,
            action="export.json_failed",
            user_id=user_id,
            detail={"reason": "admin_all_requires_admin"},
        )
        session.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin permission required")

    try:
        data = collect_export_data(session, current_user=current_user, all_users=admin_all)
        path = export_path("json", user_id=user_id, scope="all" if admin_all else "mine")
        path.write_text(json_export_content(data), encoding="utf-8")
        add_audit_log(
            session,
            request=request,
            action="export.json",
            user_id=user_id,
            detail={"filename": path.name, "admin_all": admin_all},
        )
        session.commit()
        return FileResponse(path, media_type="application/json", filename=path.name)
    except Exception as error:
        session.rollback()
        message = safe_error_message(error)
        add_audit_log(
            session,
            request=request,
            action="export.json_failed",
            user_id=user_id,
            detail={"error": message, "admin_all": admin_all},
        )
        session.commit()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Export failed") from error


@exports_router.get("/markdown")
def export_markdown(
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> FileResponse:
    user_id = current_user.id or 0
    try:
        data = collect_export_data(session, current_user=current_user)
        path = export_path("md", user_id=user_id, scope="mine")
        path.write_text(markdown_export_content(data), encoding="utf-8")
        add_audit_log(
            session,
            request=request,
            action="export.markdown",
            user_id=user_id,
            detail={"filename": path.name},
        )
        session.commit()
        return FileResponse(path, media_type="text/markdown", filename=path.name)
    except Exception as error:
        session.rollback()
        message = safe_error_message(error)
        add_audit_log(
            session,
            request=request,
            action="export.markdown_failed",
            user_id=user_id,
            detail={"error": message},
        )
        session.commit()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Export failed") from error


@exports_router.get("/zip")
def export_zip(
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> FileResponse:
    user_id = current_user.id or 0
    try:
        data = collect_export_data(session, current_user=current_user)
        attachments = session.exec(select(Attachment).where(Attachment.user_id == user_id)).all()
        path = export_path("zip", user_id=user_id, scope="mine")
        attachment_files: list[dict[str, Any]] = []
        skipped_attachments: list[int] = []

        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zip_file:
            zip_file.writestr("export.json", json_export_content(data))
            zip_file.writestr("export.md", markdown_export_content(data))
            for attachment in attachments:
                attachment_path = safe_attachment_file(attachment)
                if attachment_path is None:
                    if attachment.id is not None:
                        skipped_attachments.append(attachment.id)
                    continue
                archive_name = f"attachments/{attachment.id}_{safe_filename(attachment.filename)}"
                zip_file.write(attachment_path, archive_name)
                attachment_files.append(
                    {
                        "attachment_id": attachment.id,
                        "filename": attachment.filename,
                        "archive_path": archive_name,
                        "size": attachment.size,
                        "sha256": attachment.sha256,
                    }
                )
            manifest = {
                "source": MANIFEST_SOURCE,
                "format_version": MANIFEST_VERSION,
                "exported_at": utc_now().isoformat(),
                "scope": "current_user",
                "user_id": user_id,
                "attachment_files": attachment_files,
                "skipped_attachment_ids": skipped_attachments,
            }
            zip_file.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2, default=str))

        add_audit_log(
            session,
            request=request,
            action="export.zip",
            user_id=user_id,
            detail={"filename": path.name, "attachments": len(attachment_files), "skipped": skipped_attachments},
        )
        session.commit()
        return FileResponse(path, media_type="application/zip", filename=path.name)
    except Exception as error:
        session.rollback()
        message = safe_error_message(error)
        add_audit_log(
            session,
            request=request,
            action="export.zip_failed",
            user_id=user_id,
            detail={"error": message},
        )
        session.commit()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Export failed") from error

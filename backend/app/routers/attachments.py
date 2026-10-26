import hashlib
import hmac
import os
import re
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from app.audit import add_audit_log
from app.config import get_settings, project_path
from app.database import get_session
from app.deps import get_current_user
from app.models import Attachment, Honor, Memory, Project, User, utc_now
from app.schemas import AttachmentRead, DeletePasswordRequest
from app.security import hash_password, verify_password

router = APIRouter(prefix="/api/attachments", tags=["attachments"])

ATTACHMENTS_DIR = project_path("data", "attachments")
MAX_FILE_SIZE = 20 * 1024 * 1024
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
BLOCKED_EXTENSIONS = {".exe", ".bat", ".cmd", ".js", ".vbs", ".ps1", ".msi"}
MIME_BY_EXTENSION = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

DELETE_PASSWORD_FILE = project_path("data", "delete_password.key")


def _read_delete_password() -> str:
    if DELETE_PASSWORD_FILE.exists():
        return DELETE_PASSWORD_FILE.read_text(encoding="utf-8").strip()
    configured = get_settings().initial_delete_password.strip()
    if not configured:
        return ""
    _write_delete_password(configured)
    return DELETE_PASSWORD_FILE.read_text(encoding="utf-8").strip()


def _write_delete_password(new_password: str) -> None:
    DELETE_PASSWORD_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = DELETE_PASSWORD_FILE.with_name(f".{DELETE_PASSWORD_FILE.name}.{uuid4().hex}.tmp")
    try:
        temporary_path.write_text(hash_password(new_password.strip()), encoding="utf-8")
        os.replace(temporary_path, DELETE_PASSWORD_FILE)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def verify_delete_password(password: str) -> bool:
    if not password or not password.strip():
        return False
    stored = _read_delete_password()
    if not stored:
        return False
    if stored.startswith(("$2a$", "$2b$", "$2y$")):
        return verify_password(password.strip(), stored)
    # Migrate legacy plaintext exactly once, before accepting the operation.
    if not hmac.compare_digest(password.strip().encode("utf-8"), stored.encode("utf-8")):
        return False
    _write_delete_password(stored)
    return True


def assert_delete_password(payload: DeletePasswordRequest) -> None:
    if not verify_delete_password(payload.password):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="密码错误")


def safe_filename(filename: str) -> str:
    name = Path(filename or "attachment").name.strip() or "attachment"
    return re.sub(r"[^A-Za-z0-9._\-\u4e00-\u9fff]", "_", name)[:180]


def attachment_path(attachment: Attachment) -> Path:
    path = Path(attachment.stored_path)
    if not path.is_absolute():
        path = ATTACHMENTS_DIR / path
    resolved = path.resolve()
    root = ATTACHMENTS_DIR.resolve()
    if not resolved.is_relative_to(root):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    return resolved


def delete_file_if_safe(attachment: Attachment) -> None:
    path = attachment_path(attachment)
    if path.exists() and path.is_file():
        path.unlink()


def validate_owner(session: Session, *, owner_type: str, owner_id: int, user_id: int) -> None:
    owner_models = {
        "honor": Honor,
        "memory": Memory,
        "project": Project,
    }
    model = owner_models.get(owner_type)
    if model is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported owner type")
    owner = session.exec(
        select(model).where(model.id == owner_id, model.user_id == user_id)
    ).first()
    if owner is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Owner not found")


def delete_existing_honor_main_images(session: Session, *, honor_id: int, user_id: int) -> None:
    existing = session.exec(
        select(Attachment).where(
            Attachment.user_id == user_id,
            Attachment.owner_type == "honor",
            Attachment.owner_id == honor_id,
        )
    ).all()
    for attachment in existing:
        suffix = Path(attachment.filename).suffix.lower()
        if (attachment.mime_type or "").startswith("image/") or suffix in IMAGE_EXTENSIONS:
            delete_file_if_safe(attachment)
            session.delete(attachment)


def get_attachment_for_user(session: Session, attachment_id: int, user_id: int) -> Attachment:
    attachment = session.exec(
        select(Attachment).where(Attachment.id == attachment_id, Attachment.user_id == user_id)
    ).first()
    if attachment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    return attachment


@router.post("/upload", response_model=AttachmentRead)
async def upload_attachment(
    request: Request,
    owner_type: str = Form(...),
    owner_id: int = Form(...),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Attachment:
    validate_owner(session, owner_type=owner_type, owner_id=owner_id, user_id=current_user.id)

    original_name = safe_filename(file.filename or "attachment")
    ext = Path(original_name).suffix.lower()
    if ext in BLOCKED_EXTENSIONS or ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File type not allowed")

    content = await file.read(MAX_FILE_SIZE + 1)
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large")
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File is empty")

    sha256 = hashlib.sha256(content).hexdigest()
    if owner_type == "honor" and ext in IMAGE_EXTENSIONS:
        delete_existing_honor_main_images(session, honor_id=owner_id, user_id=current_user.id)

    stored_name = f"{owner_type}_{owner_id}_{uuid4().hex}{ext}"
    ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
    stored_path = (ATTACHMENTS_DIR / stored_name).resolve()
    stored_path.write_bytes(content)

    attachment = Attachment(
        user_id=current_user.id,
        owner_type=owner_type,
        owner_id=owner_id,
        filename=original_name,
        stored_path=str(stored_path),
        mime_type=MIME_BY_EXTENSION.get(ext, file.content_type),
        size=len(content),
        sha256=sha256,
        created_at=utc_now(),
    )
    session.add(attachment)
    session.flush()
    add_audit_log(
        session,
        request=request,
        action="attachment.upload",
        user_id=current_user.id,
        detail={
            "attachment_id": attachment.id,
            "owner_type": owner_type,
            "owner_id": owner_id,
            "filename": attachment.filename,
            "size": attachment.size,
        },
    )
    session.commit()
    session.refresh(attachment)
    return attachment


@router.get("/all", response_model=list[AttachmentRead])
def list_all_attachments(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[Attachment]:
    return list(
        session.exec(
            select(Attachment)
            .where(Attachment.user_id == current_user.id)
            .order_by(Attachment.created_at.desc())
        ).all()
    )


@router.get("/{attachment_id}", response_class=FileResponse)
def download_attachment(
    attachment_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> FileResponse:
    attachment = get_attachment_for_user(session, attachment_id, current_user.id)
    path = attachment_path(attachment)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment file not found")
    return FileResponse(
        path,
        media_type=attachment.mime_type or "application/octet-stream",
        filename=attachment.filename,
        content_disposition_type="inline",
    )


@router.delete("/{attachment_id}")
def delete_attachment(
    attachment_id: int,
    payload: DeletePasswordRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    assert_delete_password(payload)
    attachment = get_attachment_for_user(session, attachment_id, current_user.id)
    delete_file_if_safe(attachment)
    session.delete(attachment)
    add_audit_log(
        session,
        request=request,
        action="attachment.delete",
        user_id=current_user.id,
        detail={"attachment_id": attachment_id, "filename": attachment.filename},
    )
    session.commit()
    return {"ok": True}

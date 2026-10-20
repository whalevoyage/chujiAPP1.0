from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_
from sqlmodel import Session, col, select

from app.audit import add_audit_log
from app.database import get_session
from app.deps import get_current_user
from app.models import Attachment, Honor, User, utc_now
from app.routers.attachments import assert_delete_password, delete_file_if_safe
from app.schemas import AttachmentRead, DeletePasswordRequest, HonorCreate, HonorRead, HonorUpdate

router = APIRouter(prefix="/api/honors", tags=["honors"])


def get_honor_for_user(session: Session, honor_id: int, user_id: int) -> Honor:
    honor = session.exec(
        select(Honor).where(Honor.id == honor_id, Honor.user_id == user_id)
    ).first()
    if honor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Honor not found")
    return honor


def attachments_for_honors(
    session: Session,
    *,
    user_id: int,
    honor_ids: list[int],
) -> dict[int, list[Attachment]]:
    if not honor_ids:
        return {}
    rows = session.exec(
        select(Attachment)
        .where(
            Attachment.user_id == user_id,
            Attachment.owner_type == "honor",
            col(Attachment.owner_id).in_(honor_ids),
        )
        .order_by(Attachment.created_at.desc())
    ).all()
    grouped: dict[int, list[Attachment]] = {}
    for attachment in rows:
        grouped.setdefault(attachment.owner_id, []).append(attachment)
    return grouped


def honor_response(honor: Honor, attachments: list[Attachment] | None = None) -> dict[str, object]:
    items = attachments or []
    return {
        "id": honor.id,
        "user_id": honor.user_id,
        "title": honor.title,
        "honor_type": honor.honor_type,
        "level": honor.level,
        "issuer": honor.issuer,
        "award_date": honor.award_date,
        "role": honor.role,
        "weight": honor.weight,
        "resume_ready": honor.resume_ready,
        "is_featured": honor.is_featured,
        "description": honor.description,
        "created_at": honor.created_at,
        "updated_at": honor.updated_at,
        "attachment_count": len(items),
        "attachments": [AttachmentRead.model_validate(item) for item in items],
    }


@router.get("", response_model=list[HonorRead])
def list_honors(
    honor_type: str | None = Query(default=None),
    level: str | None = Query(default=None),
    resume_ready: bool | None = Query(default=None),
    q: str | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, object]]:
    statement = select(Honor).where(Honor.user_id == current_user.id)
    if honor_type:
        statement = statement.where(Honor.honor_type == honor_type)
    if level:
        statement = statement.where(Honor.level == level)
    if resume_ready is not None:
        statement = statement.where(Honor.resume_ready == resume_ready)
    keyword = (q or "").strip()
    if keyword:
        pattern = f"%{keyword}%"
        statement = statement.where(
            or_(
                Honor.title.like(pattern),
                Honor.issuer.like(pattern),
                Honor.description.like(pattern),
            )
        )
    statement = statement.order_by(
        Honor.weight.desc(),
        Honor.award_date.desc(),
        Honor.created_at.desc(),
    )
    honors = session.exec(statement).all()
    grouped = attachments_for_honors(
        session,
        user_id=current_user.id,
        honor_ids=[honor.id for honor in honors if honor.id is not None],
    )
    return [honor_response(honor, grouped.get(honor.id or 0, [])) for honor in honors]


@router.post("", response_model=HonorRead)
def create_honor(
    payload: HonorCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    now = utc_now()
    honor = Honor(
        user_id=current_user.id,
        title=payload.title.strip(),
        honor_type=payload.honor_type.strip(),
        level=payload.level.strip() if payload.level else None,
        issuer=payload.issuer.strip() if payload.issuer else None,
        award_date=payload.award_date,
        role=payload.role.strip() if payload.role else None,
        weight=payload.weight,
        resume_ready=payload.resume_ready,
        is_featured=payload.is_featured,
        description=payload.description.strip() if payload.description else None,
        created_at=now,
        updated_at=now,
    )
    session.add(honor)
    session.flush()
    add_audit_log(
        session,
        request=request,
        action="honor.create",
        user_id=current_user.id,
        detail={"honor_id": honor.id, "title": honor.title},
    )
    session.commit()
    session.refresh(honor)
    return honor_response(honor, [])


@router.get("/{honor_id}", response_model=HonorRead)
def get_honor(
    honor_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    honor = get_honor_for_user(session, honor_id, current_user.id)
    grouped = attachments_for_honors(session, user_id=current_user.id, honor_ids=[honor_id])
    return honor_response(honor, grouped.get(honor_id, []))


@router.put("/{honor_id}", response_model=HonorRead)
def update_honor(
    honor_id: int,
    payload: HonorUpdate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    honor = get_honor_for_user(session, honor_id, current_user.id)
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(honor, field, value)
    honor.updated_at = utc_now()
    session.add(honor)
    add_audit_log(
        session,
        request=request,
        action="honor.update",
        user_id=current_user.id,
        detail={"honor_id": honor.id, "title": honor.title},
    )
    session.commit()
    session.refresh(honor)
    grouped = attachments_for_honors(session, user_id=current_user.id, honor_ids=[honor_id])
    return honor_response(honor, grouped.get(honor_id, []))


@router.delete("/{honor_id}")
def delete_honor(
    honor_id: int,
    payload: DeletePasswordRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    assert_delete_password(payload)
    honor = get_honor_for_user(session, honor_id, current_user.id)
    attachments = session.exec(
        select(Attachment).where(
            Attachment.user_id == current_user.id,
            Attachment.owner_type == "honor",
            Attachment.owner_id == honor_id,
        )
    ).all()
    for attachment in attachments:
        delete_file_if_safe(attachment)
        session.delete(attachment)
    session.delete(honor)
    add_audit_log(
        session,
        request=request,
        action="honor.delete",
        user_id=current_user.id,
        detail={"honor_id": honor_id, "attachment_count": len(attachments)},
    )
    session.commit()
    return {"ok": True}

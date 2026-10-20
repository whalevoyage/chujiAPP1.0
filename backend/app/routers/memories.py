from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_
from sqlmodel import Session, col, select

from app.audit import add_audit_log
from app.database import get_session
from app.deps import get_current_user
from app.models import Attachment, Memory, User, utc_now
from app.routers.attachments import assert_delete_password, delete_file_if_safe
from app.schemas import AttachmentRead, DeletePasswordRequest, MemoryCreate, MemoryRead, MemoryUpdate

router = APIRouter(prefix="/api/memories", tags=["memories"])


def get_memory_for_user(session: Session, memory_id: int, user_id: int) -> Memory:
    memory = session.exec(
        select(Memory).where(Memory.id == memory_id, Memory.user_id == user_id)
    ).first()
    if memory is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory not found")
    return memory


def attachments_for_memories(
    session: Session, *, user_id: int, memory_ids: list[int],
) -> dict[int, list[Attachment]]:
    if not memory_ids:
        return {}
    rows = session.exec(
        select(Attachment)
        .where(Attachment.user_id == user_id, Attachment.owner_type == "memory", col(Attachment.owner_id).in_(memory_ids))
        .order_by(Attachment.created_at.desc())
    ).all()
    grouped: dict[int, list[Attachment]] = {}
    for a in rows:
        grouped.setdefault(a.owner_id, []).append(a)
    return grouped


def memory_response(memory: Memory, attachments: list[Attachment] | None = None) -> dict:
    items = attachments or []
    return {
        "id": memory.id, "user_id": memory.user_id,
        "title": memory.title, "photo_date": memory.photo_date,
        "location": memory.location, "story": memory.story,
        "tags": [t.strip() for t in (memory.tags or "").split(",") if t.strip()],
        "created_at": memory.created_at, "updated_at": memory.updated_at,
        "attachment_count": len(items),
        "attachments": [AttachmentRead.model_validate(a) for a in items],
    }


@router.get("", response_model=list[MemoryRead])
def list_memories(
    q: str | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    statement = select(Memory).where(Memory.user_id == current_user.id)
    keyword = (q or "").strip()
    if keyword:
        pattern = f"%{keyword}%"
        statement = statement.where(or_(Memory.title.like(pattern), Memory.location.like(pattern), Memory.tags.like(pattern)))
    statement = statement.order_by(Memory.photo_date.desc(), Memory.created_at.desc())
    memories = session.exec(statement).all()
    grouped = attachments_for_memories(session, user_id=current_user.id, memory_ids=[m.id for m in memories if m.id is not None])
    return [memory_response(m, grouped.get(m.id or 0, [])) for m in memories]


@router.post("", response_model=MemoryRead)
def create_memory(
    payload: MemoryCreate, request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    now = utc_now()
    memory = Memory(
        user_id=current_user.id, title=payload.title.strip(),
        photo_date=payload.photo_date,
        location=payload.location.strip() if payload.location else None,
        story=payload.story.strip() if payload.story else None,
        tags=",".join(payload.tags) if payload.tags else None,
        created_at=now, updated_at=now,
    )
    session.add(memory); session.flush()
    add_audit_log(session, request=request, action="memory.create", user_id=current_user.id, detail={"memory_id": memory.id, "title": memory.title})
    session.commit(); session.refresh(memory)
    return memory_response(memory, [])


@router.get("/{memory_id}", response_model=MemoryRead)
def get_memory(memory_id: int, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)) -> dict:
    memory = get_memory_for_user(session, memory_id, current_user.id)
    grouped = attachments_for_memories(session, user_id=current_user.id, memory_ids=[memory_id])
    return memory_response(memory, grouped.get(memory_id, []))


@router.put("/{memory_id}", response_model=MemoryRead)
def update_memory(
    memory_id: int, payload: MemoryUpdate, request: Request,
    session: Session = Depends(get_session), current_user: User = Depends(get_current_user),
) -> dict:
    memory = get_memory_for_user(session, memory_id, current_user.id)
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if field == "tags" and isinstance(value, list):
            value = ",".join(value) if value else None
        elif isinstance(value, str):
            value = value.strip() or None
        setattr(memory, field, value)
    memory.updated_at = utc_now(); session.add(memory)
    add_audit_log(session, request=request, action="memory.update", user_id=current_user.id, detail={"memory_id": memory.id})
    session.commit(); session.refresh(memory)
    grouped = attachments_for_memories(session, user_id=current_user.id, memory_ids=[memory_id])
    return memory_response(memory, grouped.get(memory_id, []))


@router.delete("/{memory_id}")
def delete_memory(memory_id: int, payload: DeletePasswordRequest, request: Request, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)) -> dict:
    assert_delete_password(payload)
    memory = get_memory_for_user(session, memory_id, current_user.id)
    atts = session.exec(select(Attachment).where(Attachment.user_id == current_user.id, Attachment.owner_type == "memory", Attachment.owner_id == memory_id)).all()
    for a in atts:
        delete_file_if_safe(a)
        session.delete(a)
    session.delete(memory)
    add_audit_log(session, request=request, action="memory.delete", user_id=current_user.id, detail={"memory_id": memory_id, "attachment_count": len(atts)})
    session.commit()
    return {"ok": True}

from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_
from sqlmodel import Session, select

from app.audit import add_audit_log
from app.database import get_session
from app.deps import get_current_user
from app.models import DiaryEntry, Tag, TagLink, User, utc_now
from app.schemas import DiaryCreate, DiaryRead, DiaryUpdate, TagCreate, TagRead

router = APIRouter(prefix="/api/diary", tags=["diary"])
tags_router = APIRouter(prefix="/api/tags", tags=["tags"])


def today_str() -> str:
    return date.today().isoformat()


def normalize_tags(tags: list[str] | None) -> list[str]:
    if not tags:
        return []
    result: list[str] = []
    seen: set[str] = set()
    for raw_tag in tags:
        tag = raw_tag.strip()
        key = tag.lower()
        if not tag or key in seen:
            continue
        seen.add(key)
        result.append(tag[:50])
    return result


def generated_title(content: str) -> str:
    plain = " ".join(content.strip().split())
    return (plain[:20] or "未命名日记").strip()


def get_entry_for_user(session: Session, entry_id: int, user_id: int) -> DiaryEntry:
    entry = session.get(DiaryEntry, entry_id)
    if entry is None or entry.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    return entry


def get_or_create_tag(
    session: Session,
    *,
    user_id: int,
    name: str,
    color: str | None = None,
) -> Tag:
    normalized = name.strip()
    tag = session.exec(
        select(Tag).where(Tag.user_id == user_id, Tag.name == normalized)
    ).first()
    if tag is not None:
        return tag
    tag = Tag(user_id=user_id, name=normalized, color=color, created_at=utc_now())
    session.add(tag)
    session.flush()
    return tag


def replace_entry_tags(
    session: Session,
    *,
    user_id: int,
    entry_id: int,
    tags: list[str],
) -> None:
    existing_links = session.exec(
        select(TagLink).where(
            TagLink.user_id == user_id,
            TagLink.target_type == "diary",
            TagLink.target_id == entry_id,
        )
    ).all()
    for link in existing_links:
        session.delete(link)
    session.flush()

    for tag_name in normalize_tags(tags):
        tag = get_or_create_tag(session, user_id=user_id, name=tag_name)
        session.add(
            TagLink(
                user_id=user_id,
                tag_id=tag.id,
                target_type="diary",
                target_id=entry_id,
            )
        )


def entry_tags_by_id(
    session: Session,
    *,
    user_id: int,
    entry_ids: list[int],
) -> dict[int, list[str]]:
    if not entry_ids:
        return {}

    links = session.exec(
        select(TagLink).where(
            TagLink.user_id == user_id,
            TagLink.target_type == "diary",
            TagLink.target_id.in_(entry_ids),
        )
    ).all()
    tag_ids = sorted({link.tag_id for link in links})
    if not tag_ids:
        return {}

    tags = session.exec(
        select(Tag).where(Tag.user_id == user_id, Tag.id.in_(tag_ids))
    ).all()
    tag_names = {tag.id: tag.name for tag in tags}
    grouped: dict[int, list[str]] = defaultdict(list)
    for link in links:
        tag_name = tag_names.get(link.tag_id)
        if tag_name:
            grouped[link.target_id].append(tag_name)
    return grouped


def entry_response(entry: DiaryEntry, tags: list[str]) -> dict[str, object]:
    return {
        "id": entry.id,
        "user_id": entry.user_id,
        "title": entry.title,
        "content_md": entry.content_md,
        "mood": entry.mood,
        "entry_date": entry.entry_date,
        "is_starred": entry.is_starred,
        "is_private": entry.is_private,
        "is_deleted": entry.is_deleted,
        "deleted_at": entry.deleted_at,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
        "tags": tags,
    }


def entries_response(
    session: Session,
    *,
    entries: list[DiaryEntry],
    user_id: int,
) -> list[dict[str, object]]:
    tags_by_entry = entry_tags_by_id(
        session,
        user_id=user_id,
        entry_ids=[entry.id for entry in entries if entry.id is not None],
    )
    return [entry_response(entry, tags_by_entry.get(entry.id or 0, [])) for entry in entries]


@router.get("", response_model=list[DiaryRead])
def list_diary(
    include_deleted: bool = False,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, object]]:
    statement = select(DiaryEntry).where(DiaryEntry.user_id == current_user.id)
    if not include_deleted:
        statement = statement.where(DiaryEntry.is_deleted == False)  # noqa: E712
    entries = session.exec(
        statement.order_by(DiaryEntry.entry_date.desc(), DiaryEntry.created_at.desc())
    ).all()
    return entries_response(session, entries=entries, user_id=current_user.id)


@router.post("", response_model=DiaryRead)
def create_diary(
    payload: DiaryCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    content = payload.content_md.strip()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Content is required")

    now = utc_now()
    title = payload.title.strip() if payload.title and payload.title.strip() else generated_title(content)
    entry = DiaryEntry(
        user_id=current_user.id,
        title=title,
        content_md=content,
        mood=payload.mood,
        entry_date=payload.entry_date or today_str(),
        is_starred=payload.is_starred,
        is_private=payload.is_private,
        is_deleted=False,
        deleted_at=None,
        created_at=now,
        updated_at=now,
    )
    session.add(entry)
    session.flush()
    replace_entry_tags(session, user_id=current_user.id, entry_id=entry.id, tags=payload.tags)
    add_audit_log(
        session,
        request=request,
        action="diary.create",
        user_id=current_user.id,
        detail={"entry_id": entry.id, "title": entry.title, "entry_date": entry.entry_date},
    )
    session.commit()
    session.refresh(entry)
    tags_by_entry = entry_tags_by_id(session, user_id=current_user.id, entry_ids=[entry.id])
    return entry_response(entry, tags_by_entry.get(entry.id or 0, []))


@router.get("/search", response_model=list[DiaryRead])
def search_diary(
    q: str = Query(default=""),
    include_deleted: bool = False,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, object]]:
    keyword = q.strip()
    statement = select(DiaryEntry).where(DiaryEntry.user_id == current_user.id)
    if not include_deleted:
        statement = statement.where(DiaryEntry.is_deleted == False)  # noqa: E712
    if keyword:
        statement = statement.where(
            or_(
                DiaryEntry.title.contains(keyword),
                DiaryEntry.content_md.contains(keyword),
            )
        )
    entries = session.exec(
        statement.order_by(DiaryEntry.entry_date.desc(), DiaryEntry.created_at.desc())
    ).all()
    return entries_response(session, entries=entries, user_id=current_user.id)


@router.get("/{entry_id}", response_model=DiaryRead)
def get_diary(
    entry_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    entry = get_entry_for_user(session, entry_id, current_user.id)
    tags_by_entry = entry_tags_by_id(session, user_id=current_user.id, entry_ids=[entry_id])
    return entry_response(entry, tags_by_entry.get(entry_id, []))


@router.put("/{entry_id}", response_model=DiaryRead)
def update_diary(
    entry_id: int,
    payload: DiaryUpdate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    entry = get_entry_for_user(session, entry_id, current_user.id)
    update_data = payload.model_dump(exclude_unset=True)
    if "content_md" in update_data and update_data["content_md"] is not None:
        content = update_data["content_md"].strip()
        if not content:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Content is required")
        entry.content_md = content
    if "title" in update_data:
        title = update_data["title"]
        entry.title = title.strip() if title and title.strip() else generated_title(entry.content_md)
    if "mood" in update_data:
        entry.mood = update_data["mood"]
    if "entry_date" in update_data and update_data["entry_date"] is not None:
        entry.entry_date = update_data["entry_date"]
    if "is_starred" in update_data and update_data["is_starred"] is not None:
        entry.is_starred = update_data["is_starred"]
    if "is_private" in update_data and update_data["is_private"] is not None:
        entry.is_private = update_data["is_private"]
    entry.updated_at = utc_now()
    session.add(entry)
    if payload.tags is not None:
        replace_entry_tags(session, user_id=current_user.id, entry_id=entry_id, tags=payload.tags)
    add_audit_log(
        session,
        request=request,
        action="diary.update",
        user_id=current_user.id,
        detail={"entry_id": entry.id, "title": entry.title},
    )
    session.commit()
    session.refresh(entry)
    tags_by_entry = entry_tags_by_id(session, user_id=current_user.id, entry_ids=[entry_id])
    return entry_response(entry, tags_by_entry.get(entry_id, []))


@router.delete("/{entry_id}")
def delete_diary(
    entry_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    entry = get_entry_for_user(session, entry_id, current_user.id)
    entry.is_deleted = True
    entry.deleted_at = utc_now()
    entry.updated_at = utc_now()
    session.add(entry)
    add_audit_log(
        session,
        request=request,
        action="diary.delete",
        user_id=current_user.id,
        detail={"entry_id": entry_id},
    )
    session.commit()
    return {"ok": True}


@router.post("/{entry_id}/restore", response_model=DiaryRead)
def restore_diary(
    entry_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    entry = get_entry_for_user(session, entry_id, current_user.id)
    entry.is_deleted = False
    entry.deleted_at = None
    entry.updated_at = utc_now()
    session.add(entry)
    add_audit_log(
        session,
        request=request,
        action="diary.restore",
        user_id=current_user.id,
        detail={"entry_id": entry_id},
    )
    session.commit()
    session.refresh(entry)
    tags_by_entry = entry_tags_by_id(session, user_id=current_user.id, entry_ids=[entry_id])
    return entry_response(entry, tags_by_entry.get(entry_id, []))


@tags_router.get("", response_model=list[TagRead])
def list_tags(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[Tag]:
    return list(
        session.exec(
            select(Tag).where(Tag.user_id == current_user.id).order_by(Tag.name)
        ).all()
    )


@tags_router.post("", response_model=TagRead)
def create_tag(
    payload: TagCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Tag:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tag name is required")

    existing = session.exec(
        select(Tag).where(Tag.user_id == current_user.id, Tag.name == name)
    ).first()
    if existing is not None:
        return existing

    tag = Tag(user_id=current_user.id, name=name, color=payload.color, created_at=utc_now())
    session.add(tag)
    session.flush()
    add_audit_log(
        session,
        request=request,
        action="diary.tag.create",
        user_id=current_user.id,
        detail={"tag_id": tag.id, "name": tag.name},
    )
    session.commit()
    session.refresh(tag)
    return tag

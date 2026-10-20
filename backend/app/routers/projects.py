from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_
from sqlmodel import Session, col, select

from app.audit import add_audit_log
from app.database import get_session
from app.deps import get_current_user
from app.models import Attachment, Project, User, utc_now
from app.routers.attachments import assert_delete_password, delete_file_if_safe
from app.schemas import AttachmentRead, DeletePasswordRequest, ProjectCreate, ProjectRead, ProjectUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"])


def get_project_for_user(session: Session, project_id: int, user_id: int) -> Project:
    project = session.exec(select(Project).where(Project.id == project_id, Project.user_id == user_id)).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def attachments_for_projects(session: Session, *, user_id: int, project_ids: list[int]) -> dict[int, list[Attachment]]:
    if not project_ids: return {}
    rows = session.exec(select(Attachment).where(Attachment.user_id == user_id, Attachment.owner_type == "project", col(Attachment.owner_id).in_(project_ids)).order_by(Attachment.created_at.desc())).all()
    grouped: dict[int, list[Attachment]] = {}
    for a in rows:
        grouped.setdefault(a.owner_id, []).append(a)
    return grouped


def project_response(project: Project, attachments: list[Attachment] | None = None) -> dict:
    items = attachments or []
    return {
        "id": project.id, "user_id": project.user_id,
        "name": project.name, "project_type": project.project_type,
        "start_date": project.start_date, "status": project.status,
        "tech_stack": project.tech_stack, "summary": project.summary,
        "link": project.link, "achievements": project.achievements,
        "next_plan": project.next_plan,
        "created_at": project.created_at, "updated_at": project.updated_at,
        "attachment_count": len(items),
        "attachments": [AttachmentRead.model_validate(a) for a in items],
    }


@router.get("", response_model=list[ProjectRead])
def list_projects(
    q: str | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    statement = select(Project).where(Project.user_id == current_user.id)
    keyword = (q or "").strip()
    if keyword:
        pattern = f"%{keyword}%"
        statement = statement.where(or_(Project.name.like(pattern), Project.project_type.like(pattern), Project.tech_stack.like(pattern), Project.summary.like(pattern)))
    statement = statement.order_by(Project.start_date.desc(), Project.created_at.desc())
    projects = session.exec(statement).all()
    grouped = attachments_for_projects(session, user_id=current_user.id, project_ids=[p.id for p in projects if p.id is not None])
    return [project_response(p, grouped.get(p.id or 0, [])) for p in projects]


@router.post("", response_model=ProjectRead)
def create_project(
    payload: ProjectCreate, request: Request,
    session: Session = Depends(get_session), current_user: User = Depends(get_current_user),
) -> dict:
    now = utc_now()
    project = Project(
        user_id=current_user.id, name=payload.name.strip(),
        project_type=payload.project_type.strip() if payload.project_type else None,
        start_date=payload.start_date, status=payload.status or "进行中",
        tech_stack=payload.tech_stack.strip() if payload.tech_stack else None,
        summary=payload.summary.strip() if payload.summary else None,
        link=payload.link.strip() if payload.link else None,
        achievements=payload.achievements.strip() if payload.achievements else None,
        next_plan=payload.next_plan.strip() if payload.next_plan else None,
        created_at=now, updated_at=now,
    )
    session.add(project); session.flush()
    add_audit_log(session, request=request, action="project.create", user_id=current_user.id, detail={"project_id": project.id, "name": project.name})
    session.commit(); session.refresh(project)
    return project_response(project, [])


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project_id: int, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)) -> dict:
    project = get_project_for_user(session, project_id, current_user.id)
    grouped = attachments_for_projects(session, user_id=current_user.id, project_ids=[project_id])
    return project_response(project, grouped.get(project_id, []))


@router.put("/{project_id}", response_model=ProjectRead)
def update_project(
    project_id: int, payload: ProjectUpdate, request: Request,
    session: Session = Depends(get_session), current_user: User = Depends(get_current_user),
) -> dict:
    project = get_project_for_user(session, project_id, current_user.id)
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if isinstance(value, str): value = value.strip() or None
        setattr(project, field, value)
    project.updated_at = utc_now(); session.add(project)
    add_audit_log(session, request=request, action="project.update", user_id=current_user.id, detail={"project_id": project.id})
    session.commit(); session.refresh(project)
    grouped = attachments_for_projects(session, user_id=current_user.id, project_ids=[project_id])
    return project_response(project, grouped.get(project_id, []))


@router.delete("/{project_id}")
def delete_project(project_id: int, payload: DeletePasswordRequest, request: Request, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)) -> dict:
    assert_delete_password(payload)
    project = get_project_for_user(session, project_id, current_user.id)
    atts = session.exec(select(Attachment).where(Attachment.user_id == current_user.id, Attachment.owner_type == "project", Attachment.owner_id == project_id)).all()
    for a in atts:
        delete_file_if_safe(a)
        session.delete(a)
    session.delete(project)
    add_audit_log(session, request=request, action="project.delete", user_id=current_user.id, detail={"project_id": project_id, "attachment_count": len(atts)})
    session.commit()
    return {"ok": True}

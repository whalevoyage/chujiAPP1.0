from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlmodel import Session, select

from app.audit import add_audit_log
from app.database import get_session
from app.deps import get_current_user
from app.models import (
    DailyPlan,
    ImprovementAction,
    PlanStep,
    Task,
    User,
    WeaknessRecord,
    utc_now,
)
from app.schemas import (
    ImprovementActionCreate,
    ImprovementActionRead,
    ImprovementActionUpdate,
    WeaknessCreate,
    WeaknessRead,
    WeaknessUpdate,
)

router = APIRouter(prefix="/api/weaknesses", tags=["weaknesses"])
actions_router = APIRouter(prefix="/api/improvement-actions", tags=["improvement-actions"])


def today_str() -> str:
    return date.today().isoformat()


def tomorrow_str() -> str:
    return (date.today() + timedelta(days=1)).isoformat()


def title_from_behavior(behavior: str) -> str:
    plain = " ".join(behavior.strip().split())
    return (plain[:20] or "未命名问题").strip()


def get_weakness_for_user(session: Session, weakness_id: int, user_id: int) -> WeaknessRecord:
    record = session.get(WeaknessRecord, weakness_id)
    if record is None or record.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Weakness not found")
    return record


def get_action_for_user(session: Session, action_id: int, user_id: int) -> ImprovementAction:
    action = session.get(ImprovementAction, action_id)
    if action is None or action.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action not found")
    return action


def create_action_from_correction(
    session: Session,
    *,
    user_id: int,
    weakness_id: int,
    correction: str | None,
    add_to_plan: bool,
) -> ImprovementAction | None:
    if not correction or not correction.strip():
        return None
    title = correction.strip()[:200]
    action = ImprovementAction(
        user_id=user_id,
        weakness_id=weakness_id,
        title=title,
        description=correction.strip(),
        difficulty=5,
        estimated_minutes=30,
        add_to_plan=add_to_plan,
        status="未执行",
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    session.add(action)
    session.flush()
    return action


def get_or_create_tomorrow_plan(session: Session, *, user_id: int) -> DailyPlan:
    target_date = tomorrow_str()
    plan = session.exec(
        select(DailyPlan).where(
            DailyPlan.user_id == user_id,
            DailyPlan.plan_date == target_date,
        )
    ).first()
    if plan is not None:
        return plan
    now = utc_now()
    plan = DailyPlan(
        user_id=user_id,
        plan_date=target_date,
        title="明日改进计划",
        main_goal="处理复盘中发现的问题",
        note=None,
        status="active",
        created_at=now,
        updated_at=now,
    )
    session.add(plan)
    session.flush()
    return plan


@router.get("", response_model=list[WeaknessRead])
def list_weaknesses(
    include_deleted: bool = False,
    category: str | None = None,
    severity: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[WeaknessRecord]:
    statement = select(WeaknessRecord).where(WeaknessRecord.user_id == current_user.id)
    if not include_deleted:
        statement = statement.where(WeaknessRecord.is_deleted == False)  # noqa: E712
    if category:
        statement = statement.where(WeaknessRecord.category == category)
    if severity is not None:
        statement = statement.where(WeaknessRecord.severity == severity)
    if date_from:
        statement = statement.where(WeaknessRecord.occur_date >= date_from)
    if date_to:
        statement = statement.where(WeaknessRecord.occur_date <= date_to)
    return list(
        session.exec(
            statement.order_by(WeaknessRecord.occur_date.desc(), WeaknessRecord.created_at.desc())
        ).all()
    )


@router.post("", response_model=WeaknessRead)
def create_weakness(
    payload: WeaknessCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WeaknessRecord:
    behavior = payload.behavior.strip()
    if not behavior:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Behavior is required")
    now = utc_now()
    record = WeaknessRecord(
        user_id=current_user.id,
        title=payload.title.strip() if payload.title and payload.title.strip() else title_from_behavior(behavior),
        category=payload.category,
        severity=payload.severity,
        occur_date=payload.occur_date or today_str(),
        occur_period=payload.occur_period,
        behavior=behavior,
        reason=payload.reason,
        impact=payload.impact,
        emotion=payload.emotion,
        correction=payload.correction,
        prevention=payload.prevention,
        is_resolved=False,
        review_count=0,
        is_deleted=False,
        deleted_at=None,
        created_at=now,
        updated_at=now,
    )
    session.add(record)
    session.flush()
    action = create_action_from_correction(
        session,
        user_id=current_user.id,
        weakness_id=record.id,
        correction=payload.correction,
        add_to_plan=payload.add_to_plan,
    )
    if payload.add_to_plan and action is not None:
        plan = get_or_create_tomorrow_plan(session, user_id=current_user.id)
        existing_steps = session.exec(
            select(PlanStep).where(
                PlanStep.user_id == current_user.id,
                PlanStep.plan_id == plan.id,
            )
        ).all()
        step = PlanStep(
            user_id=current_user.id,
            plan_id=plan.id,
            title=action.title,
            description=action.description,
            start_time="09:00",
            end_time="09:30",
            remind_time=None,
            remind_before_minutes=None,
            priority=action.difficulty,
            enable_reminder=False,
            linked_task_id=None,
            sort_order=len(existing_steps),
            status="pending",
            created_at=now,
            updated_at=now,
        )
        session.add(step)
    add_audit_log(
        session,
        request=request,
        action="weakness.create",
        user_id=current_user.id,
        detail={"weakness_id": record.id, "title": record.title},
    )
    session.commit()
    session.refresh(record)
    return record


@router.get("/{weakness_id}", response_model=WeaknessRead)
def get_weakness(
    weakness_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WeaknessRecord:
    return get_weakness_for_user(session, weakness_id, current_user.id)


@router.put("/{weakness_id}", response_model=WeaknessRead)
def update_weakness(
    weakness_id: int,
    payload: WeaknessUpdate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WeaknessRecord:
    record = get_weakness_for_user(session, weakness_id, current_user.id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "title":
            value = value.strip() if value and value.strip() else title_from_behavior(record.behavior)
        if field == "behavior" and value is not None:
            value = value.strip()
        setattr(record, field, value)
    record.updated_at = utc_now()
    session.add(record)
    add_audit_log(
        session,
        request=request,
        action="weakness.update",
        user_id=current_user.id,
        detail={"weakness_id": record.id, "title": record.title},
    )
    session.commit()
    session.refresh(record)
    return record


@router.delete("/{weakness_id}")
def delete_weakness(
    weakness_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    record = get_weakness_for_user(session, weakness_id, current_user.id)
    record.is_deleted = True
    record.deleted_at = utc_now()
    record.updated_at = utc_now()
    session.add(record)
    add_audit_log(
        session,
        request=request,
        action="weakness.delete",
        user_id=current_user.id,
        detail={"weakness_id": weakness_id},
    )
    session.commit()
    return {"ok": True}


@router.post("/{weakness_id}/resolve", response_model=WeaknessRead)
def resolve_weakness(
    weakness_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WeaknessRecord:
    record = get_weakness_for_user(session, weakness_id, current_user.id)
    record.is_resolved = True
    record.review_count += 1
    record.updated_at = utc_now()
    session.add(record)
    add_audit_log(
        session,
        request=request,
        action="weakness.resolve",
        user_id=current_user.id,
        detail={"weakness_id": weakness_id, "title": record.title},
    )
    session.commit()
    session.refresh(record)
    return record


@router.post("/{weakness_id}/restore", response_model=WeaknessRead)
def restore_weakness(
    weakness_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WeaknessRecord:
    record = get_weakness_for_user(session, weakness_id, current_user.id)
    record.is_deleted = False
    record.deleted_at = None
    record.updated_at = utc_now()
    session.add(record)
    add_audit_log(
        session,
        request=request,
        action="weakness.restore",
        user_id=current_user.id,
        detail={"weakness_id": weakness_id, "title": record.title},
    )
    session.commit()
    session.refresh(record)
    return record


@router.get("/{weakness_id}/actions", response_model=list[ImprovementActionRead])
def list_improvement_actions(
    weakness_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[ImprovementAction]:
    get_weakness_for_user(session, weakness_id, current_user.id)
    return list(
        session.exec(
            select(ImprovementAction)
            .where(
                ImprovementAction.user_id == current_user.id,
                ImprovementAction.weakness_id == weakness_id,
            )
            .order_by(ImprovementAction.created_at.desc())
        ).all()
    )


@router.post("/{weakness_id}/actions", response_model=ImprovementActionRead)
def create_improvement_action(
    weakness_id: int,
    payload: ImprovementActionCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ImprovementAction:
    get_weakness_for_user(session, weakness_id, current_user.id)
    now = utc_now()
    action = ImprovementAction(
        user_id=current_user.id,
        weakness_id=weakness_id,
        title=payload.title.strip(),
        description=payload.description,
        difficulty=payload.difficulty,
        estimated_minutes=payload.estimated_minutes,
        add_to_plan=payload.add_to_plan,
        add_to_task=payload.add_to_task,
        status="未执行",
        created_at=now,
        updated_at=now,
    )
    session.add(action)
    session.flush()
    add_audit_log(
        session,
        request=request,
        action="weakness.action.create",
        user_id=current_user.id,
        detail={"action_id": action.id, "weakness_id": weakness_id, "title": action.title},
    )
    session.commit()
    session.refresh(action)
    return action


@actions_router.put("/{action_id}", response_model=ImprovementActionRead)
def update_improvement_action(
    action_id: int,
    payload: ImprovementActionUpdate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ImprovementAction:
    action = get_action_for_user(session, action_id, current_user.id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "title" and isinstance(value, str):
            value = value.strip()
        setattr(action, field, value)
    action.updated_at = utc_now()
    session.add(action)
    add_audit_log(
        session,
        request=request,
        action="weakness.action.update",
        user_id=current_user.id,
        detail={"action_id": action.id, "title": action.title},
    )
    session.commit()
    session.refresh(action)
    return action


@actions_router.post("/{action_id}/complete", response_model=ImprovementActionRead)
def complete_improvement_action(
    action_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ImprovementAction:
    action = get_action_for_user(session, action_id, current_user.id)
    action.status = "已完成"
    action.completed_at = utc_now()
    action.updated_at = utc_now()
    session.add(action)
    add_audit_log(
        session,
        request=request,
        action="weakness.action.complete",
        user_id=current_user.id,
        detail={"action_id": action.id, "title": action.title},
    )
    session.commit()
    session.refresh(action)
    return action


@actions_router.post("/{action_id}/add-to-plan")
def add_action_to_plan(
    action_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    action = get_action_for_user(session, action_id, current_user.id)
    plan = get_or_create_tomorrow_plan(session, user_id=current_user.id)
    existing_steps = session.exec(
        select(PlanStep).where(PlanStep.user_id == current_user.id, PlanStep.plan_id == plan.id)
    ).all()
    now = utc_now()
    step = PlanStep(
        user_id=current_user.id,
        plan_id=plan.id,
        title=action.title,
        description=action.description,
        start_time="09:00",
        end_time="09:30",
        remind_time=None,
        remind_before_minutes=None,
        priority=action.difficulty,
        enable_reminder=False,
        linked_task_id=None,
        sort_order=len(existing_steps),
        status="pending",
        created_at=now,
        updated_at=now,
    )
    action.add_to_plan = True
    action.updated_at = now
    session.add(step)
    session.add(action)
    session.flush()
    add_audit_log(
        session,
        request=request,
        action="weakness.action.add_to_plan",
        user_id=current_user.id,
        detail={"action_id": action.id, "plan_id": plan.id, "step_id": step.id},
    )
    session.commit()
    return {"ok": True, "plan_id": plan.id, "step_id": step.id}


@actions_router.post("/{action_id}/add-to-task")
def add_action_to_task(
    action_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    action = get_action_for_user(session, action_id, current_user.id)
    now = utc_now()
    task = Task(
        user_id=current_user.id,
        title=action.title,
        category="复盘改进",
        task_type="improvement",
        frequency="once",
        priority=action.difficulty,
        weight=None,
        estimated_minutes=action.estimated_minutes,
        is_active=True,
        sort_order=0,
        created_at=now,
        updated_at=now,
    )
    action.add_to_task = True
    action.updated_at = now
    session.add(task)
    session.add(action)
    session.flush()
    add_audit_log(
        session,
        request=request,
        action="weakness.action.add_to_task",
        user_id=current_user.id,
        detail={"action_id": action.id, "task_id": task.id},
    )
    session.commit()
    return {"ok": True, "task_id": task.id}

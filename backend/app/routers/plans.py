from collections import defaultdict
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlmodel import Session, select

from app.audit import add_audit_log
from app.database import get_session
from app.deps import get_current_user
from app.models import DailyPlan, PlanStep, Task, User, utc_now
from app.schemas import (
    DailyPlanCreate,
    DailyPlanUpdate,
    DailyPlanWithSteps,
    PlanStepCreate,
    PlanStepRead,
    PlanStepUpdate,
    StepActionRequest,
)

router = APIRouter(prefix="/api/plans", tags=["plans"])
steps_router = APIRouter(prefix="/api/plan-steps", tags=["plan-steps"])
reminders_router = APIRouter(prefix="/api/reminders", tags=["reminders"])

ACTIVE_STEP_STATUSES = {"pending", "in_progress", "delayed"}


def today_str() -> str:
    return date.today().isoformat()


def current_time_str() -> str:
    return datetime.now().strftime("%H:%M")


def get_plan_for_user(session: Session, plan_id: int, user_id: int) -> DailyPlan:
    plan = session.get(DailyPlan, plan_id)
    if plan is None or plan.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    return plan


def get_step_for_user(session: Session, step_id: int, user_id: int) -> PlanStep:
    step = session.get(PlanStep, step_id)
    if step is None or step.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step not found")
    return step


def ensure_task_belongs_to_user(
    session: Session,
    task_id: int | None,
    user_id: int,
) -> None:
    if task_id is None:
        return
    task = session.get(Task, task_id)
    if task is None or task.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Linked task not found")


def steps_for_plans(
    session: Session,
    *,
    plan_ids: list[int],
    user_id: int,
) -> dict[int, list[PlanStep]]:
    if not plan_ids:
        return {}
    steps = session.exec(
        select(PlanStep)
        .where(PlanStep.user_id == user_id, PlanStep.plan_id.in_(plan_ids))
        .order_by(PlanStep.sort_order, PlanStep.start_time, PlanStep.id)
    ).all()
    grouped: dict[int, list[PlanStep]] = defaultdict(list)
    for step in steps:
        grouped[step.plan_id].append(step)
    return grouped


def plan_response(plan: DailyPlan, steps: list[PlanStep]) -> dict[str, object]:
    completed_steps = sum(1 for step in steps if step.status == "completed")
    total_steps = len(steps)
    return {
        "id": plan.id,
        "user_id": plan.user_id,
        "plan_date": plan.plan_date,
        "title": plan.title,
        "main_goal": plan.main_goal,
        "note": plan.note,
        "status": plan.status,
        "created_at": plan.created_at,
        "updated_at": plan.updated_at,
        "steps": steps,
        "total_steps": total_steps,
        "completed_steps": completed_steps,
        "progress": completed_steps / total_steps if total_steps else 0,
    }


def refresh_plan_status(session: Session, plan_id: int, user_id: int) -> None:
    plan = get_plan_for_user(session, plan_id, user_id)
    steps = session.exec(
        select(PlanStep).where(PlanStep.user_id == user_id, PlanStep.plan_id == plan_id)
    ).all()
    if steps and all(step.status in {"completed", "skipped"} for step in steps):
        plan.status = "completed"
    else:
        plan.status = "active"
    plan.updated_at = utc_now()
    session.add(plan)


@router.get("/today", response_model=list[DailyPlanWithSteps])
def get_today_plans(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, object]]:
    user_id = current_user.id
    plans = session.exec(
        select(DailyPlan)
        .where(DailyPlan.user_id == user_id, DailyPlan.plan_date == today_str())
        .order_by(DailyPlan.created_at)
    ).all()
    grouped_steps = steps_for_plans(
        session,
        plan_ids=[plan.id for plan in plans if plan.id is not None],
        user_id=user_id,
    )
    return [plan_response(plan, grouped_steps.get(plan.id or 0, [])) for plan in plans]


@router.get("", response_model=list[DailyPlanWithSteps])
def get_plans(
    date: str | None = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, object]]:
    user_id = current_user.id
    target_date = date or today_str()
    plans = session.exec(
        select(DailyPlan)
        .where(DailyPlan.user_id == user_id, DailyPlan.plan_date == target_date)
        .order_by(DailyPlan.created_at)
    ).all()
    grouped_steps = steps_for_plans(
        session,
        plan_ids=[plan.id for plan in plans if plan.id is not None],
        user_id=user_id,
    )
    return [plan_response(plan, grouped_steps.get(plan.id or 0, [])) for plan in plans]


@router.get("/{plan_id}", response_model=DailyPlanWithSteps)
def get_plan(
    plan_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    user_id = current_user.id
    plan = get_plan_for_user(session, plan_id, user_id)
    steps = steps_for_plans(session, plan_ids=[plan_id], user_id=user_id).get(plan_id, [])
    return plan_response(plan, steps)


@router.post("", response_model=DailyPlanWithSteps)
def create_plan(
    payload: DailyPlanCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    now = utc_now()
    plan = DailyPlan(
        user_id=current_user.id,
        plan_date=payload.plan_date,
        title=payload.title.strip(),
        main_goal=payload.main_goal,
        note=payload.note,
        status=payload.status,
        created_at=now,
        updated_at=now,
    )
    session.add(plan)
    session.flush()
    add_audit_log(
        session,
        request=request,
        action="plan.create",
        user_id=current_user.id,
        detail={"plan_id": plan.id, "title": plan.title, "plan_date": plan.plan_date},
    )
    session.commit()
    session.refresh(plan)
    return plan_response(plan, [])


@router.put("/{plan_id}", response_model=DailyPlanWithSteps)
def update_plan(
    plan_id: int,
    payload: DailyPlanUpdate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    plan = get_plan_for_user(session, plan_id, current_user.id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if isinstance(value, str) and field == "title":
            value = value.strip()
        setattr(plan, field, value)
    plan.updated_at = utc_now()
    session.add(plan)
    add_audit_log(
        session,
        request=request,
        action="plan.update",
        user_id=current_user.id,
        detail={"plan_id": plan.id, "title": plan.title},
    )
    session.commit()
    session.refresh(plan)
    steps = steps_for_plans(session, plan_ids=[plan_id], user_id=current_user.id).get(plan_id, [])
    return plan_response(plan, steps)


@router.delete("/{plan_id}")
def delete_plan(
    plan_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    plan = get_plan_for_user(session, plan_id, current_user.id)
    steps = session.exec(
        select(PlanStep).where(PlanStep.user_id == current_user.id, PlanStep.plan_id == plan_id)
    ).all()
    for step in steps:
        session.delete(step)
    session.delete(plan)
    add_audit_log(
        session,
        request=request,
        action="plan.delete",
        user_id=current_user.id,
        detail={"plan_id": plan_id},
    )
    session.commit()
    return {"ok": True}


@router.post("/{plan_id}/steps", response_model=PlanStepRead)
def create_step(
    plan_id: int,
    payload: PlanStepCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> PlanStep:
    get_plan_for_user(session, plan_id, current_user.id)
    ensure_task_belongs_to_user(session, payload.linked_task_id, current_user.id)
    now = utc_now()
    step = PlanStep(
        user_id=current_user.id,
        plan_id=plan_id,
        title=payload.title.strip(),
        description=payload.description,
        start_time=payload.start_time,
        end_time=payload.end_time,
        remind_time=payload.remind_time,
        remind_before_minutes=payload.remind_before_minutes,
        priority=payload.priority,
        enable_reminder=payload.enable_reminder,
        linked_task_id=payload.linked_task_id,
        sort_order=payload.sort_order,
        status="pending",
        created_at=now,
        updated_at=now,
    )
    session.add(step)
    session.flush()
    refresh_plan_status(session, plan_id, current_user.id)
    add_audit_log(
        session,
        request=request,
        action="plan.step.create",
        user_id=current_user.id,
        detail={"step_id": step.id, "plan_id": plan_id, "title": step.title},
    )
    session.commit()
    session.refresh(step)
    return step


@steps_router.put("/{step_id}", response_model=PlanStepRead)
def update_step(
    step_id: int,
    payload: PlanStepUpdate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> PlanStep:
    step = get_step_for_user(session, step_id, current_user.id)
    update_data = payload.model_dump(exclude_unset=True)
    if "linked_task_id" in update_data:
        ensure_task_belongs_to_user(session, update_data["linked_task_id"], current_user.id)
    for field, value in update_data.items():
        if isinstance(value, str) and field == "title":
            value = value.strip()
        setattr(step, field, value)
    step.updated_at = utc_now()
    session.add(step)
    refresh_plan_status(session, step.plan_id, current_user.id)
    add_audit_log(
        session,
        request=request,
        action="plan.step.update",
        user_id=current_user.id,
        detail={"step_id": step.id, "title": step.title},
    )
    session.commit()
    session.refresh(step)
    return step


@steps_router.delete("/{step_id}")
def delete_step(
    step_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    step = get_step_for_user(session, step_id, current_user.id)
    plan_id = step.plan_id
    session.delete(step)
    session.flush()
    refresh_plan_status(session, plan_id, current_user.id)
    add_audit_log(
        session,
        request=request,
        action="plan.step.delete",
        user_id=current_user.id,
        detail={"step_id": step_id},
    )
    session.commit()
    return {"ok": True}


@steps_router.post("/{step_id}/start", response_model=PlanStepRead)
def start_step(
    step_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> PlanStep:
    step = get_step_for_user(session, step_id, current_user.id)
    step.status = "in_progress"
    step.updated_at = utc_now()
    session.add(step)
    refresh_plan_status(session, step.plan_id, current_user.id)
    add_audit_log(
        session,
        request=request,
        action="plan.step.start",
        user_id=current_user.id,
        detail={"step_id": step.id, "title": step.title},
    )
    session.commit()
    session.refresh(step)
    return step


@steps_router.post("/{step_id}/complete", response_model=PlanStepRead)
def complete_step(
    step_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> PlanStep:
    step = get_step_for_user(session, step_id, current_user.id)
    step.status = "completed"
    step.completed_at = utc_now()
    step.delay_reason = None
    step.skip_reason = None
    step.updated_at = utc_now()
    session.add(step)
    refresh_plan_status(session, step.plan_id, current_user.id)
    add_audit_log(
        session,
        request=request,
        action="plan.step.complete",
        user_id=current_user.id,
        detail={"step_id": step.id, "title": step.title},
    )
    session.commit()
    session.refresh(step)
    return step


@steps_router.post("/{step_id}/delay", response_model=PlanStepRead)
def delay_step(
    step_id: int,
    payload: StepActionRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> PlanStep:
    step = get_step_for_user(session, step_id, current_user.id)
    step.status = "delayed"
    step.delay_reason = payload.reason.strip()
    step.skip_reason = None
    step.completed_at = None
    step.updated_at = utc_now()
    session.add(step)
    refresh_plan_status(session, step.plan_id, current_user.id)
    add_audit_log(
        session,
        request=request,
        action="plan.step.delay",
        user_id=current_user.id,
        detail={"step_id": step.id, "title": step.title, "reason": step.delay_reason},
    )
    session.commit()
    session.refresh(step)
    return step


@steps_router.post("/{step_id}/skip", response_model=PlanStepRead)
def skip_step(
    step_id: int,
    payload: StepActionRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> PlanStep:
    step = get_step_for_user(session, step_id, current_user.id)
    step.status = "skipped"
    step.skip_reason = payload.reason.strip()
    step.delay_reason = None
    step.completed_at = None
    step.updated_at = utc_now()
    session.add(step)
    refresh_plan_status(session, step.plan_id, current_user.id)
    add_audit_log(
        session,
        request=request,
        action="plan.step.skip",
        user_id=current_user.id,
        detail={"step_id": step.id, "title": step.title, "reason": step.skip_reason},
    )
    session.commit()
    session.refresh(step)
    return step


@reminders_router.get("/current", response_model=PlanStepRead | None)
def get_current_reminder(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> PlanStep | None:
    now_time = current_time_str()
    statement = (
        select(PlanStep)
        .join(DailyPlan, DailyPlan.id == PlanStep.plan_id)
        .where(
            DailyPlan.user_id == current_user.id,
            DailyPlan.plan_date == today_str(),
            PlanStep.user_id == current_user.id,
            PlanStep.status.in_(["pending", "in_progress"]),
            PlanStep.start_time <= now_time,
            PlanStep.end_time >= now_time,
        )
        .order_by(PlanStep.start_time, PlanStep.sort_order, PlanStep.id)
    )
    return session.exec(statement).first()


@reminders_router.get("/upcoming", response_model=list[PlanStepRead])
def get_upcoming_reminders(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[PlanStep]:
    now_time = current_time_str()
    steps = session.exec(
        select(PlanStep)
        .join(DailyPlan, DailyPlan.id == PlanStep.plan_id)
        .where(
            DailyPlan.user_id == current_user.id,
            DailyPlan.plan_date == today_str(),
            PlanStep.user_id == current_user.id,
            PlanStep.status.in_(list(ACTIVE_STEP_STATUSES)),
        )
        .order_by(PlanStep.start_time, PlanStep.sort_order, PlanStep.id)
    ).all()
    upcoming = [
        step
        for step in steps
        if (step.remind_time if step.enable_reminder and step.remind_time else step.start_time)
        > now_time
    ]
    return sorted(
        upcoming,
        key=lambda step: step.remind_time
        if step.enable_reminder and step.remind_time
        else step.start_time,
    )

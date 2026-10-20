from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlmodel import Session, select

from app.audit import add_audit_log
from app.database import get_session
from app.deps import get_current_user
from app.models import Task, TaskLog, User, utc_now
from app.schemas import (
    TaskCheckinRequest,
    TaskCreate,
    TaskLogRead,
    TaskMakeupRequest,
    TaskStatsRead,
    TaskTodayRead,
    TaskUpdate,
    TotalStatsRead,
)

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def encouragement(rate: float) -> str:
    if rate <= 0:
        return "今天刚开始"
    if rate < 0.5:
        return "慢慢来，先完成一件"
    if rate < 0.9:
        return "进度不错"
    return "今天很稳"


def today_str() -> str:
    return date.today().isoformat()


def get_task_for_user(
    session: Session,
    task_id: int,
    user_id: int,
    *,
    include_inactive: bool = False,
) -> Task:
    task = session.get(Task, task_id)
    if task is None or task.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not include_inactive and not task.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


def today_logs_for_tasks(
    session: Session,
    *,
    user_id: int,
    task_ids: list[int],
) -> dict[int, TaskLog]:
    if not task_ids:
        return {}
    logs = session.exec(
        select(TaskLog)
        .where(
            TaskLog.user_id == user_id,
            TaskLog.task_id.in_(task_ids),
            TaskLog.log_date == today_str(),
            TaskLog.is_makeup == False,  # noqa: E712
        )
        .order_by(TaskLog.created_at.desc())
    ).all()
    result: dict[int, TaskLog] = {}
    for log in logs:
        result.setdefault(log.task_id, log)
    return result


def task_response(task: Task, today_log: TaskLog | None) -> dict[str, object]:
    return {
        "id": task.id,
        "user_id": task.user_id,
        "title": task.title,
        "category": task.category,
        "task_type": task.task_type,
        "frequency": task.frequency,
        "priority": task.priority,
        "weight": task.weight,
        "estimated_minutes": task.estimated_minutes,
        "is_active": task.is_active,
        "sort_order": task.sort_order,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "checked_in": today_log is not None,
        "today_log": today_log,
    }


def get_today_log(session: Session, *, user_id: int, task_id: int) -> TaskLog | None:
    return session.exec(
        select(TaskLog).where(
            TaskLog.user_id == user_id,
            TaskLog.task_id == task_id,
            TaskLog.log_date == today_str(),
            TaskLog.is_makeup == False,  # noqa: E712
        )
    ).first()


@router.get("/today", response_model=list[TaskTodayRead])
def get_today_tasks(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, object]]:
    tasks = session.exec(
        select(Task)
        .where(Task.user_id == current_user.id, Task.is_active == True)  # noqa: E712
        .order_by(Task.sort_order, Task.priority.desc(), Task.created_at)
    ).all()
    logs = today_logs_for_tasks(
        session,
        user_id=current_user.id,
        task_ids=[task.id for task in tasks if task.id is not None],
    )
    return [task_response(task, logs.get(task.id or 0)) for task in tasks]


@router.get("/stats", response_model=TaskStatsRead)
def get_task_stats(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, float | int]:
    active_tasks = session.exec(
        select(Task).where(Task.user_id == current_user.id, Task.is_active == True)  # noqa: E712
    ).all()
    active_task_ids = [task.id for task in active_tasks if task.id is not None]
    if not active_task_ids:
        return {"total": 0, "completed_today": 0, "completion_rate": 0}

    logs = session.exec(
        select(TaskLog).where(
            TaskLog.user_id == current_user.id,
            TaskLog.task_id.in_(active_task_ids),
            TaskLog.log_date == today_str(),
            TaskLog.is_makeup == False,  # noqa: E712
        )
    ).all()
    completed_task_ids = {log.task_id for log in logs}
    completed_today = len(completed_task_ids)
    total = len(active_task_ids)
    return {
        "total": total,
        "completed_today": completed_today,
        "completion_rate": completed_today / total if total else 0,
        "encouragement": encouragement(completed_today / total if total else 0),
    }


@router.get("/streak")
def get_streak(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    """连续打卡天数"""
    active_tasks = session.exec(
        select(Task).where(Task.user_id == current_user.id, Task.is_active == True)  # noqa: E712
    ).all()
    if not active_tasks:
        return {"streak": 0, "today_done": False}

    task_ids = [t.id for t in active_tasks if t.id is not None]
    logs = session.exec(
        select(TaskLog).where(
            TaskLog.user_id == current_user.id,
            TaskLog.task_id.in_(task_ids),
            TaskLog.is_makeup == False,  # noqa: E712
        ).order_by(TaskLog.log_date.desc())
    ).all()

    # 按日期分组
    dates_done: set[str] = set()
    date_counts: dict[str, int] = {}
    for log in logs:
        dates_done.add(log.log_date)
        date_counts[log.log_date] = date_counts.get(log.log_date, 0) + 1

    today = today_str()
    # 检查今天是否所有活跃任务都打卡了
    today_count = date_counts.get(today, 0)
    today_done = today_count >= len(active_tasks) if active_tasks else False

    # 从今天往前数连续天数
    streak = 0
    check_date = date.today()
    while True:
        ds = check_date.isoformat()
        count = date_counts.get(ds, 0)
        if count >= len(active_tasks) and len(active_tasks) > 0:
            streak += 1
            check_date = check_date - __import__('datetime').timedelta(days=1)
        else:
            break

    return {"streak": streak, "today_done": today_done}


@router.get("/weekly-summary")
def get_weekly_summary(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    """本周摘要"""
    import datetime as _dt
    today_date = date.today()
    monday = today_date - _dt.timedelta(days=today_date.weekday())
    week_dates = [(monday + _dt.timedelta(days=i)).isoformat() for i in range(7)]

    # 本周任务完成
    task_logs = session.exec(
        select(TaskLog).where(
            TaskLog.user_id == current_user.id,
            TaskLog.is_makeup == False,  # noqa: E712
            TaskLog.log_date.in_(week_dates),
        )
    ).all()

    # 本周规划步骤完成
    from app.models import PlanStep
    plan_steps = session.exec(
        select(PlanStep).where(
            PlanStep.user_id == current_user.id,
            PlanStep.status == "completed",
        )
    ).all()
    week_completed_steps = [
        s for s in plan_steps
        if s.completed_at and s.completed_at.strftime("%Y-%m-%d") in week_dates
    ]

    # 本周专注
    from app.models import FocusSession
    focus_sessions = session.exec(
        select(FocusSession).where(
            FocusSession.user_id == current_user.id,
            FocusSession.status == "completed",
        )
    ).all()
    week_focus = [
        f for f in focus_sessions
        if f.started_at and f.started_at.strftime("%Y-%m-%d") in week_dates
    ]
    week_focus_minutes = sum(f.duration_seconds for f in week_focus) // 60

    # 每日完成热力图数据
    daily_completion = {}
    for ds in week_dates:
        day_logs = [l for l in task_logs if l.log_date == ds]
        daily_completion[ds] = len(day_logs)

    return {
        "week_start": week_dates[0],
        "week_end": week_dates[6],
        "tasks_completed": len(task_logs),
        "steps_completed": len(week_completed_steps),
        "focus_sessions": len(week_focus),
        "focus_minutes": week_focus_minutes,
        "daily_completion": daily_completion,
    }


@router.get("/stats/total", response_model=TotalStatsRead)
def get_total_stats(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    active_tasks = session.exec(
        select(Task).where(Task.user_id == current_user.id, Task.is_active == True)  # noqa: E712
    ).all()
    if not active_tasks:
        return {"total_tasks": 0, "total_completed": 0, "completion_rate": 0, "encouragement": encouragement(0)}

    all_logs = session.exec(
        select(TaskLog).where(
            TaskLog.user_id == current_user.id,
            TaskLog.is_makeup == False,  # noqa: E712
        )
    ).all()

    # Count all non-makeup logs
    total_completed = len(all_logs)

    # Estimate total possible: number of active tasks × number of distinct days with any activity
    distinct_dates = {log.log_date for log in all_logs}
    distinct_dates.add(today_str())
    active_days = len(distinct_dates)
    total_possible = len(active_tasks) * max(active_days, 1)

    rate = total_completed / total_possible if total_possible else 0
    return {
        "total_tasks": total_possible,
        "total_completed": total_completed,
        "completion_rate": min(rate, 1.0),
        "encouragement": encouragement(rate),
    }


@router.get("", response_model=list[TaskTodayRead])
def get_tasks(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, object]]:
    tasks = session.exec(
        select(Task)
        .where(Task.user_id == current_user.id, Task.is_active == True)  # noqa: E712
        .order_by(Task.sort_order, Task.priority.desc(), Task.created_at)
    ).all()
    logs = today_logs_for_tasks(
        session,
        user_id=current_user.id,
        task_ids=[task.id for task in tasks if task.id is not None],
    )
    return [task_response(task, logs.get(task.id or 0)) for task in tasks]


@router.get("/{task_id}", response_model=TaskTodayRead)
def get_task(
    task_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    task = get_task_for_user(session, task_id, current_user.id)
    return task_response(task, get_today_log(session, user_id=current_user.id, task_id=task_id))


@router.post("", response_model=TaskTodayRead)
def create_task(
    payload: TaskCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    now = utc_now()
    task = Task(
        user_id=current_user.id,
        title=payload.title.strip(),
        category=payload.category,
        task_type=payload.task_type,
        frequency=payload.frequency,
        priority=payload.priority,
        weight=payload.weight,
        estimated_minutes=payload.estimated_minutes,
        is_active=payload.is_active,
        sort_order=payload.sort_order,
        created_at=now,
        updated_at=now,
    )
    session.add(task)
    session.flush()
    add_audit_log(
        session,
        request=request,
        action="task.create",
        user_id=current_user.id,
        detail={"task_id": task.id, "title": task.title},
    )
    session.commit()
    session.refresh(task)
    return task_response(task, None)


@router.put("/{task_id}", response_model=TaskTodayRead)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    task = get_task_for_user(session, task_id, current_user.id, include_inactive=True)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if isinstance(value, str) and field == "title":
            value = value.strip()
        setattr(task, field, value)
    task.updated_at = utc_now()
    session.add(task)
    add_audit_log(
        session,
        request=request,
        action="task.update",
        user_id=current_user.id,
        detail={"task_id": task.id, "title": task.title},
    )
    session.commit()
    session.refresh(task)
    return task_response(task, get_today_log(session, user_id=current_user.id, task_id=task_id))


@router.delete("/{task_id}")
def delete_task(
    task_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    task = get_task_for_user(session, task_id, current_user.id)
    task.is_active = False
    task.updated_at = utc_now()
    session.add(task)
    add_audit_log(
        session,
        request=request,
        action="task.delete",
        user_id=current_user.id,
        detail={"task_id": task_id},
    )
    session.commit()
    return {"ok": True}


@router.post("/{task_id}/checkin", response_model=TaskLogRead)
def checkin_task(
    task_id: int,
    payload: TaskCheckinRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> TaskLog:
    get_task_for_user(session, task_id, current_user.id)
    existing = get_today_log(session, user_id=current_user.id, task_id=task_id)
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already checked in today")

    now = utc_now()
    log = TaskLog(
        user_id=current_user.id,
        task_id=task_id,
        log_date=today_str(),
        status="completed",
        note=payload.note,
        minutes=payload.minutes,
        difficulty=payload.difficulty,
        is_makeup=False,
        created_at=now,
        updated_at=now,
    )
    session.add(log)
    session.flush()
    add_audit_log(
        session,
        request=request,
        action="task.checkin",
        user_id=current_user.id,
        detail={"task_id": task_id, "log_id": log.id},
    )
    session.commit()
    session.refresh(log)
    return log


@router.post("/{task_id}/undo-checkin")
def undo_checkin(
    task_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    get_task_for_user(session, task_id, current_user.id)
    log = get_today_log(session, user_id=current_user.id, task_id=task_id)
    if log is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No checkin found for today")
    log_id = log.id
    session.delete(log)
    add_audit_log(
        session,
        request=request,
        action="task.undo_checkin",
        user_id=current_user.id,
        detail={"task_id": task_id, "log_id": log_id},
    )
    session.commit()
    return {"ok": True}


@router.post("/{task_id}/makeup", response_model=TaskLogRead)
def makeup_task(
    task_id: int,
    payload: TaskMakeupRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> TaskLog:
    get_task_for_user(session, task_id, current_user.id)
    existing = session.exec(
        select(TaskLog).where(
            TaskLog.user_id == current_user.id,
            TaskLog.task_id == task_id,
            TaskLog.log_date == payload.log_date,
        )
    ).first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task already has a log for this date")

    now = utc_now()
    log = TaskLog(
        user_id=current_user.id,
        task_id=task_id,
        log_date=payload.log_date,
        status="completed",
        note=payload.note,
        minutes=payload.minutes,
        difficulty=payload.difficulty,
        is_makeup=True,
        makeup_reason=payload.reason.strip(),
        created_at=now,
        updated_at=now,
    )
    session.add(log)
    session.flush()
    add_audit_log(
        session,
        request=request,
        action="task.makeup",
        user_id=current_user.id,
        detail={"task_id": task_id, "log_id": log.id, "log_date": payload.log_date},
    )
    session.commit()
    session.refresh(log)
    return log

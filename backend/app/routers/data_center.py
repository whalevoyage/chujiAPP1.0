from datetime import date, timedelta
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, func, select

from app.database import get_session
from app.deps import get_current_user
from app.models import (
    Course, DailyScore, DiaryEntry, FocusSession, Honor, Memory, Project,
    TaskLog, User,
)

router = APIRouter(prefix="/api", tags=["data-center"])


@router.get("/data-center/stats")
def get_data_center_stats(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    uid = current_user.id
    today = date.today().isoformat()

    # Task completion rate (today)
    total_today = len(session.exec(select(TaskLog).where(TaskLog.user_id == uid, TaskLog.log_date == today)).all())
    completed_today = len(session.exec(select(TaskLog).where(TaskLog.user_id == uid, TaskLog.log_date == today, TaskLog.status == "completed")).all())
    task_rate = completed_today / total_today if total_today > 0 else 0.0

    # Focus stats
    focus_sessions = session.exec(select(FocusSession).where(FocusSession.user_id == uid)).all()
    total_focus = len(focus_sessions)
    total_focus_min = sum((s.duration_seconds or 0) for s in focus_sessions) // 60

    # Counts
    course_count = len(session.exec(select(Course).where(Course.user_id == uid)).all())
    honor_count = len(session.exec(select(Honor).where(Honor.user_id == uid)).all())
    project_count = len(session.exec(select(Project).where(Project.user_id == uid)).all())
    memory_count = len(session.exec(select(Memory).where(Memory.user_id == uid)).all())
    diary_count = len(session.exec(select(DiaryEntry).where(DiaryEntry.user_id == uid, DiaryEntry.is_deleted == False)).all())

    return {
        "task_completion_rate": round(task_rate, 2),
        "total_focus_sessions": total_focus,
        "total_focus_minutes": total_focus_min,
        "total_courses": course_count,
        "total_honors": honor_count,
        "total_projects": project_count,
        "total_memories": memory_count,
        "total_diary_entries": diary_count,
    }


@router.get("/today-summary")
def get_today_summary(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    uid = current_user.id
    today = date.today().isoformat()

    tasks = session.exec(select(TaskLog).where(TaskLog.user_id == uid, TaskLog.log_date == today, TaskLog.status == "completed")).all()
    courses = session.exec(select(Course).where(Course.user_id == uid, select(func.substr(Course.start_time, 1, 5)).where(1 == 1))).all()
    focus = session.exec(select(FocusSession).where(FocusSession.user_id == uid)).all()
    today_focus = [s for s in focus if s.started_at and s.started_at.strftime("%Y-%m-%d") == today]
    score = session.exec(select(DailyScore).where(DailyScore.user_id == uid, DailyScore.score_date == today)).first()

    parts = []
    if len(tasks) > 0:
        parts.append(f"已完成 {len(tasks)} 个任务")
    if len(today_focus) > 0:
        focus_today_min = sum((s.duration_seconds or 0) for s in today_focus) // 60
        parts.append(f"专注 {focus_today_min} 分钟")
    if score:
        parts.append(f"状态评分 {score.score} 分")
    if not parts:
        parts.append("今天还没有记录")

    text = "，".join(parts) + "。"
    return {
        "text": text, "task_count": len(tasks), "course_count": len(courses),
        "has_focus_today": len(today_focus) > 0,
        "score_today": score.score if score else None,
    }


@router.get("/timeline")
def get_timeline(
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    uid = current_user.id
    events: list[dict] = []

    honors = session.exec(select(Honor).where(Honor.user_id == uid).order_by(Honor.award_date.desc()).limit(limit)).all()
    for h in honors:
        if h.award_date:
            events.append({"id": h.id, "date": h.award_date, "type": "honor", "title": h.title, "description": h.description})

    projects = session.exec(select(Project).where(Project.user_id == uid).order_by(Project.start_date.desc()).limit(limit)).all()
    for p in projects:
        if p.start_date:
            events.append({"id": p.id, "date": p.start_date, "type": "project", "title": p.name, "description": p.summary})

    memories = session.exec(select(Memory).where(Memory.user_id == uid).order_by(Memory.photo_date.desc()).limit(limit)).all()
    for m in memories:
        if m.photo_date:
            events.append({"id": m.id, "date": m.photo_date, "type": "memory", "title": m.title, "description": m.story})

    events.sort(key=lambda e: e["date"], reverse=True)
    return events[:limit]


@router.get("/daily-score/summary")
def get_daily_score_summary(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    uid = current_user.id
    today = date.today()

    scores = session.exec(select(DailyScore).where(DailyScore.user_id == uid).order_by(DailyScore.score_date.desc())).all()
    total_records = len(scores)

    def avg_for_days(days: int) -> float | None:
        cutoff = (today - timedelta(days=days)).isoformat()
        subset = [s.score for s in scores if s.score_date >= cutoff]
        return round(sum(subset) / len(subset), 1) if subset else None

    avg7 = avg_for_days(7)
    avg30 = avg_for_days(30)

    trend = "stable"
    trend_text = "稳定，保持下去"
    if avg7 is not None and avg30 is not None:
        if avg7 > avg30 + 0.3:
            trend, trend_text = "up", "最近一周状态有明显好转"
        elif avg7 < avg30 - 0.3:
            trend, trend_text = "down", "最近一周状态有所下降，注意调整"

    return {"avg_7d": avg7, "avg_30d": avg30, "trend": trend, "trend_text": trend_text, "total_records": total_records}

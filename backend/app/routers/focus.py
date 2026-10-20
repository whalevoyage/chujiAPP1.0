from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlmodel import Session, select

from app.audit import add_audit_log
from app.database import get_session
from app.deps import get_current_user
from app.models import DailyReminder, DailyScore, FocusSession, User, utc_now
from app.schemas import DailyScoreCreate, DailyScoreRead, FocusSessionEnd, FocusSessionRead, FocusSessionStart, FocusTodaySummary, FocusTotalsSummary

router = APIRouter(prefix="/api/focus", tags=["focus"])


def today_str() -> str:
    return date.today().isoformat()


@router.post("/start", response_model=FocusSessionRead)
def start_focus(
    payload: FocusSessionStart,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> FocusSession:
    now = utc_now()
    fs = FocusSession(
        user_id=current_user.id,
        label=payload.label,
        planned_minutes=payload.planned_minutes,
        status="running",
        duration_seconds=0,
        started_at=now,
        created_at=now,
    )
    session.add(fs)
    session.flush()
    add_audit_log(
        session, request=request, action="focus.start",
        user_id=current_user.id, detail={"session_id": fs.id, "label": payload.label},
    )
    session.commit()
    session.refresh(fs)
    return fs


@router.post("/{session_id}/end", response_model=FocusSessionRead)
def end_focus(
    session_id: int,
    payload: FocusSessionEnd,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> FocusSession:
    fs = session.get(FocusSession, session_id)
    if fs is None or fs.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="专注记录不存在")
    if fs.status != "running":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该专注已结束")
    now = utc_now()
    fs.status = "completed"
    fs.duration_seconds = payload.duration_seconds
    fs.ended_at = now
    session.add(fs)
    add_audit_log(
        session, request=request, action="focus.end",
        user_id=current_user.id,
        detail={"session_id": fs.id, "duration_seconds": payload.duration_seconds},
    )
    session.commit()
    session.refresh(fs)
    return fs


@router.get("/today", response_model=FocusTodaySummary)
def get_today_focus(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    today = today_str()
    sessions = session.exec(
        select(FocusSession).where(
            FocusSession.user_id == current_user.id,
            FocusSession.status == "completed",
        )
    ).all()
    today_sessions = [
        s for s in sessions
        if s.started_at and s.started_at.strftime("%Y-%m-%d") == today
    ]
    total_seconds = sum(s.duration_seconds for s in today_sessions)
    return {
        "sessions_today": len(today_sessions),
        "total_minutes_today": total_seconds // 60,
    }


@router.get("/totals", response_model=FocusTotalsSummary)
def get_focus_totals(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    today = today_str()
    all_sessions = session.exec(
        select(FocusSession).where(
            FocusSession.user_id == current_user.id,
            FocusSession.status == "completed",
        )
    ).all()
    total_seconds = sum(s.duration_seconds for s in all_sessions)
    today_sessions = [
        s for s in all_sessions
        if s.started_at and s.started_at.strftime("%Y-%m-%d") == today
    ]
    today_seconds = sum(s.duration_seconds for s in today_sessions)
    return {
        "total_sessions": len(all_sessions),
        "total_minutes": total_seconds // 60,
        "sessions_today": len(today_sessions),
        "total_minutes_today": today_seconds // 60,
    }


# ── DailyScore ────────────────────────────────────────────

daily_score_router = APIRouter(prefix="/api/daily-score", tags=["daily-score"])


@daily_score_router.post("", response_model=DailyScoreRead)
def save_daily_score(
    payload: DailyScoreCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> DailyScore:
    now = utc_now()
    existing = session.exec(
        select(DailyScore).where(
            DailyScore.user_id == current_user.id,
            DailyScore.score_date == today_str(),
        )
    ).first()
    if existing:
        existing.score = payload.score
        existing.note = payload.note
        existing.updated_at = now
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing

    score = DailyScore(
        user_id=current_user.id,
        score_date=today_str(),
        score=payload.score,
        note=payload.note,
        created_at=now,
        updated_at=now,
    )
    session.add(score)
    session.flush()
    add_audit_log(
        session, request=request, action="daily_score.save",
        user_id=current_user.id, detail={"score": payload.score},
    )
    session.commit()
    session.refresh(score)
    return score


@daily_score_router.get("/today", response_model=DailyScoreRead | None)
def get_today_score(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> DailyScore | None:
    return session.exec(
        select(DailyScore).where(
            DailyScore.user_id == current_user.id,
            DailyScore.score_date == today_str(),
        )
    ).first()


# ── DailyReminder ─────────────────────────────────────────

daily_reminder_router = APIRouter(prefix="/api/daily-reminder", tags=["daily-reminder"])


@daily_reminder_router.get("/today")
def get_today_reminder(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    reminder = session.exec(
        select(DailyReminder).where(
            DailyReminder.user_id == current_user.id,
            DailyReminder.reminder_date == today_str(),
        )
    ).first()
    if reminder:
        return {"id": reminder.id, "text": reminder.text}
    return {"id": None, "text": ""}


@daily_reminder_router.post("/today")
def save_today_reminder(
    payload: dict,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    text = str(payload.get("text", "")).strip()
    now = utc_now()
    existing = session.exec(
        select(DailyReminder).where(
            DailyReminder.user_id == current_user.id,
            DailyReminder.reminder_date == today_str(),
        )
    ).first()
    if existing:
        existing.text = text
        existing.updated_at = now
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return {"id": existing.id, "text": existing.text}

    reminder = DailyReminder(
        user_id=current_user.id,
        reminder_date=today_str(),
        text=text,
        created_at=now,
        updated_at=now,
    )
    session.add(reminder)
    session.flush()
    add_audit_log(
        session, request=request, action="daily_reminder.save",
        user_id=current_user.id, detail={"text": text},
    )
    session.commit()
    session.refresh(reminder)
    return {"id": reminder.id, "text": reminder.text}

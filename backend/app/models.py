from datetime import UTC, datetime

from sqlalchemy import Column, Text
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(UTC)


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True, max_length=64)
    nickname: str = Field(max_length=100)
    password_hash: str
    role: str = Field(default="user", index=True, max_length=16)
    is_active: bool = Field(default=True, index=True)
    must_change_password: bool = Field(default=False)
    last_login_at: datetime | None = Field(default=None)
    # 天气地区偏好（和风天气 LocationID）
    weather_location_id: str | None = Field(default=None, max_length=20)
    weather_location_name: str | None = Field(default=None, max_length=100)
    weather_location_adm1: str | None = Field(default=None, max_length=100)
    weather_location_adm2: str | None = Field(default=None, max_length=100)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Memory(SQLModel, table=True):
    __tablename__ = "memories"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    title: str = Field(max_length=200)
    photo_date: str | None = Field(default=None, max_length=10)
    location: str | None = Field(default=None, max_length=200)
    story: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    tags: str | None = Field(default=None, max_length=500)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Project(SQLModel, table=True):
    __tablename__ = "projects"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    name: str = Field(max_length=200)
    project_type: str | None = Field(default=None, max_length=100)
    start_date: str | None = Field(default=None, max_length=10)
    status: str = Field(default="进行中", max_length=20)
    tech_stack: str | None = Field(default=None, max_length=500)
    summary: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    link: str | None = Field(default=None, max_length=500)
    achievements: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    next_plan: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_logs"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int | None = Field(default=None, index=True)
    action: str = Field(index=True, max_length=100)
    ip: str | None = Field(default=None, max_length=64)
    user_agent: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    detail: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(default_factory=utc_now, index=True)


class DailyPlan(SQLModel, table=True):
    __tablename__ = "daily_plans"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    plan_date: str = Field(index=True, max_length=10)
    title: str = Field(max_length=200)
    main_goal: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    status: str = Field(default="active", index=True, max_length=20)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class PlanStep(SQLModel, table=True):
    __tablename__ = "plan_steps"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    plan_id: int = Field(index=True)
    title: str = Field(max_length=200)
    description: str | None = Field(default=None, max_length=500)
    start_time: str = Field(max_length=5)
    end_time: str = Field(max_length=5)
    remind_time: str | None = Field(default=None, max_length=5)
    remind_before_minutes: int | None = Field(default=None)
    priority: int = Field(default=0)
    enable_reminder: bool = Field(default=False)
    linked_task_id: int | None = Field(default=None)
    sort_order: int = Field(default=0)
    status: str = Field(default="pending", max_length=20)
    completed_at: datetime | None = Field(default=None)
    delay_reason: str | None = Field(default=None, max_length=500)
    skip_reason: str | None = Field(default=None, max_length=500)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Task(SQLModel, table=True):
    __tablename__ = "tasks"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    title: str = Field(max_length=200)
    category: str | None = Field(default=None, max_length=100)
    task_type: str | None = Field(default=None, max_length=50)
    frequency: str | None = Field(default=None, max_length=50)
    priority: int = Field(default=0)
    weight: float | None = Field(default=None)
    estimated_minutes: int | None = Field(default=None)
    is_active: bool = Field(default=True)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class TaskLog(SQLModel, table=True):
    __tablename__ = "task_logs"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    task_id: int = Field(index=True)
    log_date: str = Field(index=True, max_length=10)
    status: str = Field(default="completed", max_length=20)
    note: str | None = Field(default=None, max_length=500)
    minutes: int | None = Field(default=None)
    difficulty: int | None = Field(default=None)
    is_makeup: bool = Field(default=False)
    makeup_reason: str | None = Field(default=None, max_length=500)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class DiaryEntry(SQLModel, table=True):
    __tablename__ = "diary_entries"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    title: str = Field(max_length=200)
    content_md: str = Field(sa_column=Column(Text, nullable=False))
    mood: str | None = Field(default=None, max_length=50)
    entry_date: str = Field(index=True, max_length=10)
    is_starred: bool = Field(default=False)
    is_private: bool = Field(default=False)
    is_deleted: bool = Field(default=False, index=True)
    deleted_at: datetime | None = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Tag(SQLModel, table=True):
    __tablename__ = "tags"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    name: str = Field(max_length=50)
    color: str | None = Field(default=None, max_length=7)
    created_at: datetime = Field(default_factory=utc_now)


class TagLink(SQLModel, table=True):
    __tablename__ = "tag_links"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    tag_id: int = Field(index=True)
    target_type: str = Field(max_length=50)
    target_id: int = Field(index=True)


class WeaknessRecord(SQLModel, table=True):
    __tablename__ = "weakness_records"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    title: str = Field(max_length=200)
    category: str = Field(default="其他", index=True, max_length=50)
    severity: int = Field(default=5, index=True)
    occur_date: str = Field(index=True, max_length=10)
    occur_period: str | None = Field(default=None, max_length=20)
    behavior: str = Field(sa_column=Column(Text, nullable=False))
    reason: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    impact: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    emotion: str | None = Field(default=None, max_length=100)
    correction: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    prevention: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    is_resolved: bool = Field(default=False, index=True)
    review_count: int = Field(default=0)
    is_deleted: bool = Field(default=False, index=True)
    deleted_at: datetime | None = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class ImprovementAction(SQLModel, table=True):
    __tablename__ = "improvement_actions"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    weakness_id: int = Field(index=True)
    title: str = Field(max_length=200)
    description: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    difficulty: int = Field(default=5)
    estimated_minutes: int | None = Field(default=None)
    add_to_plan: bool = Field(default=False)
    add_to_task: bool = Field(default=False)
    status: str = Field(default="未执行", index=True, max_length=20)
    feedback: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    completed_at: datetime | None = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class ReviewReport(SQLModel, table=True):
    __tablename__ = "review_reports"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    report_type: str = Field(index=True, max_length=20)
    start_date: str = Field(index=True, max_length=10)
    end_date: str = Field(index=True, max_length=10)
    input_summary: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    ai_prompt: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    ai_response: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    final_content: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    accepted: bool = Field(default=False)
    next_actions: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Honor(SQLModel, table=True):
    __tablename__ = "honors"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    title: str = Field(max_length=200)
    honor_type: str = Field(index=True, max_length=100)
    level: str | None = Field(default=None, index=True, max_length=100)
    issuer: str | None = Field(default=None, max_length=200)
    award_date: str | None = Field(default=None, index=True, max_length=10)
    role: str | None = Field(default=None, max_length=200)
    weight: int = Field(default=5, index=True)
    resume_ready: bool = Field(default=False, index=True)
    is_featured: bool = Field(default=False, index=True)
    description: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Attachment(SQLModel, table=True):
    __tablename__ = "attachments"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    owner_type: str = Field(index=True, max_length=50)
    owner_id: int = Field(index=True)
    filename: str = Field(max_length=255)
    stored_path: str = Field(sa_column=Column(Text, nullable=False))
    mime_type: str | None = Field(default=None, max_length=120)
    size: int = Field(default=0)
    sha256: str = Field(index=True, max_length=64)
    created_at: datetime = Field(default_factory=utc_now)


class BackupRecord(SQLModel, table=True):
    __tablename__ = "backup_records"

    id: int | None = Field(default=None, primary_key=True)
    created_by_user_id: int = Field(index=True)
    file_path: str = Field(sa_column=Column(Text, nullable=False))
    size: int = Field(default=0)
    sha256: str = Field(index=True, max_length=64)
    status: str = Field(default="success", index=True, max_length=20)
    created_at: datetime = Field(default_factory=utc_now, index=True)
    error_message: str | None = Field(default=None, sa_column=Column(Text, nullable=True))


class Course(SQLModel, table=True):
    __tablename__ = "courses"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    name: str = Field(max_length=200)
    teacher: str | None = Field(default=None, max_length=100)
    location: str | None = Field(default=None, max_length=200)
    day_of_week: int = Field(index=True)  # 0=周一, 6=周日
    start_time: str = Field(max_length=5)  # HH:MM
    end_time: str = Field(max_length=5)
    start_week: int | None = Field(default=1)
    end_week: int | None = Field(default=16)
    color: str | None = Field(default=None, max_length=20)
    note: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class FocusSession(SQLModel, table=True):
    __tablename__ = "focus_sessions"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    label: str | None = Field(default=None, max_length=200)
    status: str = Field(default="running", max_length=20)  # running, completed, cancelled
    planned_minutes: int = Field(default=25)
    duration_seconds: int = Field(default=0)
    started_at: datetime = Field(default_factory=utc_now)
    ended_at: datetime | None = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)


class DailyScore(SQLModel, table=True):
    __tablename__ = "daily_scores"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    score_date: str = Field(index=True, max_length=10)
    score: int = Field(ge=1, le=5)
    note: str | None = Field(default=None, max_length=500)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class DailyReminder(SQLModel, table=True):
    __tablename__ = "daily_reminders"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    reminder_date: str = Field(index=True, max_length=10)
    text: str = Field(max_length=500)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class ScoreCard(SQLModel, table=True):
    __tablename__ = "score_cards"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    title: str = Field(max_length=200)
    semester: str | None = Field(default=None, max_length=50)
    subjects_json: str = Field(sa_column=Column(Text, nullable=False))  # JSON: [{"name":"高数","score":92,"credit":4},...]
    total_score: float | None = Field(default=None)
    gpa: float | None = Field(default=None)
    note: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    ai_analysis: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

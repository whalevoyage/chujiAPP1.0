from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


Role = Literal["admin", "user"]


class UserRead(BaseModel):
    id: int
    username: str
    nickname: str
    role: Role
    is_active: bool
    must_change_password: bool
    created_at: datetime
    updated_at: datetime
    last_login_at: datetime | None


class AuthUserResponse(BaseModel):
    user: UserRead


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


class AdminUserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_.-]+$")
    nickname: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=256)
    role: Role = "user"
    is_active: bool = True


class AdminUserUpdate(BaseModel):
    nickname: str | None = Field(default=None, min_length=1, max_length=100)
    role: Role | None = None
    is_active: bool | None = None


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8, max_length=256)


class DeletePasswordRequest(BaseModel):
    password: str = Field(min_length=1, max_length=64)


# ── DailyPlan ──────────────────────────────────────────────

class DailyPlanCreate(BaseModel):
    plan_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    title: str = Field(..., min_length=1, max_length=200)
    main_goal: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None)
    status: str = Field(default="active", max_length=20)


class DailyPlanUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    main_goal: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None)
    status: str | None = Field(default=None, max_length=20)


class DailyPlanRead(BaseModel):
    id: int
    user_id: int
    plan_date: str
    title: str
    main_goal: str | None
    note: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── PlanStep ──────────────────────────────────────────────

class PlanStepCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    start_time: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    end_time: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    remind_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    remind_before_minutes: int | None = Field(default=None, ge=0)
    priority: int = Field(default=0)
    enable_reminder: bool = Field(default=False)
    linked_task_id: int | None = Field(default=None)
    sort_order: int = Field(default=0)


class PlanStepUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    start_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    end_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    remind_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    remind_before_minutes: int | None = Field(default=None, ge=0)
    priority: int | None = None
    enable_reminder: bool | None = None
    linked_task_id: int | None = Field(default=None)
    sort_order: int | None = None


class PlanStepRead(BaseModel):
    id: int
    user_id: int
    plan_id: int
    title: str
    description: str | None
    start_time: str
    end_time: str
    remind_time: str | None
    remind_before_minutes: int | None
    priority: int
    enable_reminder: bool
    linked_task_id: int | None
    sort_order: int
    status: str
    completed_at: datetime | None
    delay_reason: str | None
    skip_reason: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DailyPlanWithSteps(DailyPlanRead):
    steps: list[PlanStepRead] = Field(default_factory=list)
    total_steps: int = 0
    completed_steps: int = 0
    progress: float = 0


class StepActionRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=500)


# ── Task ──────────────────────────────────────────────────

class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=100)
    task_type: str | None = Field(default=None, max_length=50)
    frequency: str | None = Field(default=None, max_length=50)
    priority: int = Field(default=0)
    weight: float | None = Field(default=None, ge=0)
    estimated_minutes: int | None = Field(default=None, ge=0)
    is_active: bool = Field(default=True)
    sort_order: int = Field(default=0)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=100)
    task_type: str | None = Field(default=None, max_length=50)
    frequency: str | None = Field(default=None, max_length=50)
    priority: int | None = None
    weight: float | None = Field(default=None, ge=0)
    estimated_minutes: int | None = Field(default=None, ge=0)
    is_active: bool | None = None
    sort_order: int | None = None


class TaskRead(BaseModel):
    id: int
    user_id: int
    title: str
    category: str | None
    task_type: str | None
    frequency: str | None
    priority: int
    weight: float | None
    estimated_minutes: int | None
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── TaskLog ───────────────────────────────────────────────

class TaskCheckinRequest(BaseModel):
    note: str | None = Field(default=None, max_length=500)
    minutes: int | None = Field(default=None, ge=0)
    difficulty: int | None = Field(default=None, ge=1, le=5)


class TaskMakeupRequest(BaseModel):
    log_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    note: str | None = Field(default=None, max_length=500)
    minutes: int | None = Field(default=None, ge=0)
    difficulty: int | None = Field(default=None, ge=1, le=5)
    reason: str = Field(..., min_length=1, max_length=500)


class TaskLogRead(BaseModel):
    id: int
    user_id: int
    task_id: int
    log_date: str
    status: str
    note: str | None
    minutes: int | None
    difficulty: int | None
    is_makeup: bool
    makeup_reason: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TaskTodayRead(TaskRead):
    checked_in: bool = False
    today_log: TaskLogRead | None = None


class TaskStatsRead(BaseModel):
    total: int
    completed_today: int
    completion_rate: float


# ── Diary ──────────────────────────────────────────────────

class DiaryCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    content_md: str = Field(..., min_length=1)
    mood: str | None = Field(default=None, max_length=50)
    entry_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    is_starred: bool = Field(default=False)
    is_private: bool = Field(default=False)
    tags: list[str] = Field(default_factory=list)


class DiaryUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content_md: str | None = Field(default=None, min_length=1)
    mood: str | None = Field(default=None, max_length=50)
    entry_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    is_starred: bool | None = None
    is_private: bool | None = None
    tags: list[str] | None = None


class DiaryRead(BaseModel):
    id: int
    user_id: int
    title: str
    content_md: str
    mood: str | None
    entry_date: str
    is_starred: bool
    is_private: bool
    is_deleted: bool
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    tags: list[str] = Field(default_factory=list)

    class Config:
        from_attributes = True


class TagCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    color: str | None = Field(default=None, max_length=7)


class TagRead(BaseModel):
    id: int
    user_id: int
    name: str
    color: str | None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Review / Weakness ─────────────────────────────────────

Category = Literal["拖延", "情绪", "作息", "学习", "执行力", "专注力", "消费", "其他"]
OccurPeriod = Literal["早上", "上午", "中午", "下午", "晚上", "凌晨"]
ActionStatus = Literal["未执行", "执行中", "已完成", "无效"]
ReportType = Literal["daily", "weekly", "monthly", "custom"]


class WeaknessCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    category: Category = "其他"
    severity: int = Field(default=5, ge=1, le=10)
    occur_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    occur_period: OccurPeriod | None = None
    behavior: str = Field(..., min_length=1)
    reason: str | None = None
    impact: str | None = None
    emotion: str | None = Field(default=None, max_length=100)
    correction: str | None = None
    prevention: str | None = None
    add_to_plan: bool = False


class WeaknessUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    category: Category | None = None
    severity: int | None = Field(default=None, ge=1, le=10)
    occur_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    occur_period: OccurPeriod | None = None
    behavior: str | None = Field(default=None, min_length=1)
    reason: str | None = None
    impact: str | None = None
    emotion: str | None = Field(default=None, max_length=100)
    correction: str | None = None
    prevention: str | None = None
    is_resolved: bool | None = None


class WeaknessRead(BaseModel):
    id: int
    user_id: int
    title: str
    category: str
    severity: int
    occur_date: str
    occur_period: str | None
    behavior: str
    reason: str | None
    impact: str | None
    emotion: str | None
    correction: str | None
    prevention: str | None
    is_resolved: bool
    review_count: int
    is_deleted: bool
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ImprovementActionCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    difficulty: int = Field(default=5, ge=1, le=10)
    estimated_minutes: int | None = Field(default=None, ge=0)
    add_to_plan: bool = False
    add_to_task: bool = False


class ImprovementActionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    difficulty: int | None = Field(default=None, ge=1, le=10)
    estimated_minutes: int | None = Field(default=None, ge=0)
    add_to_plan: bool | None = None
    add_to_task: bool | None = None
    status: ActionStatus | None = None
    feedback: str | None = None


class ImprovementActionRead(BaseModel):
    id: int
    user_id: int
    weakness_id: int
    title: str
    description: str | None
    difficulty: int
    estimated_minutes: int | None
    add_to_plan: bool
    add_to_task: bool
    status: str
    feedback: str | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ReviewGenerateRequest(BaseModel):
    report_type: ReportType
    start_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class ReviewSaveResponse(BaseModel):
    report_id: int | None = None
    report_type: ReportType = "daily"
    start_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    ai_prompt: str | None = None
    ai_response: str = Field(..., min_length=1)
    final_content: str | None = None
    accepted: bool = False
    next_actions: str | None = None


class ReviewSmartSummaryResponse(BaseModel):
    report_id: int
    report_type: str
    start_date: str
    end_date: str
    input_summary: str
    ai_summary: str | None = None
    summary_material: str | None = None
    ai_enabled: bool
    message: str


class ReviewUpdate(BaseModel):
    ai_response: str | None = None
    final_content: str | None = None
    accepted: bool | None = None
    next_actions: str | None = None


class ReviewRead(BaseModel):
    id: int
    user_id: int
    report_type: str
    start_date: str
    end_date: str
    input_summary: str | None
    ai_prompt: str | None
    ai_response: str | None
    final_content: str | None
    accepted: bool
    next_actions: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# Honors / Attachments

class AttachmentRead(BaseModel):
    id: int
    user_id: int
    owner_type: str
    owner_id: int
    filename: str
    mime_type: str | None
    size: int
    sha256: str
    created_at: datetime

    class Config:
        from_attributes = True


class HonorCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    honor_type: str = Field(..., min_length=1, max_length=100)
    level: str | None = Field(default=None, max_length=100)
    issuer: str | None = Field(default=None, max_length=200)
    award_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    role: str | None = Field(default=None, max_length=200)
    weight: int = Field(default=5, ge=1, le=10)
    resume_ready: bool = False
    is_featured: bool = False
    description: str | None = None


class HonorUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    honor_type: str | None = Field(default=None, min_length=1, max_length=100)
    level: str | None = Field(default=None, max_length=100)
    issuer: str | None = Field(default=None, max_length=200)
    award_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    role: str | None = Field(default=None, max_length=200)
    weight: int | None = Field(default=None, ge=1, le=10)
    resume_ready: bool | None = None
    is_featured: bool | None = None
    description: str | None = None


class HonorRead(BaseModel):
    id: int
    user_id: int
    title: str
    honor_type: str
    level: str | None
    issuer: str | None
    award_date: str | None
    role: str | None
    weight: int
    resume_ready: bool
    is_featured: bool
    description: str | None
    created_at: datetime
    updated_at: datetime
    attachment_count: int = 0
    attachments: list[AttachmentRead] = Field(default_factory=list)

    class Config:
        from_attributes = True


class BackupRecordRead(BaseModel):
    id: int
    created_by_user_id: int
    filename: str
    size: int
    sha256: str
    status: str
    created_at: datetime
    error_message: str | None = None


# ── Course / 课表 ──────────────────────────────────────────

class CourseCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    teacher: str | None = Field(default=None, max_length=100)
    location: str | None = Field(default=None, max_length=200)
    day_of_week: int = Field(..., ge=0, le=6)
    start_time: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    end_time: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    start_week: int | None = Field(default=1, ge=1, le=30)
    end_week: int | None = Field(default=16, ge=1, le=30)
    color: str | None = Field(default=None, max_length=20)
    note: str | None = None


class CourseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    teacher: str | None = Field(default=None, max_length=100)
    location: str | None = Field(default=None, max_length=200)
    day_of_week: int | None = Field(default=None, ge=0, le=6)
    start_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    end_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    start_week: int | None = Field(default=None, ge=1, le=30)
    end_week: int | None = Field(default=None, ge=1, le=30)
    color: str | None = Field(default=None, max_length=20)
    note: str | None = None


class CourseRead(BaseModel):
    id: int
    user_id: int
    name: str
    teacher: str | None
    location: str | None
    day_of_week: int
    start_time: str
    end_time: str
    start_week: int | None
    end_week: int | None
    color: str | None
    note: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── ICS Import ─────────────────────────────────────────────

class IcsImportResponse(BaseModel):
    ok: bool
    imported: int = 0
    items: list[CourseRead] = Field(default_factory=list)
    error: str | None = None


# ── FocusSession ──────────────────────────────────────────

class FocusSessionStart(BaseModel):
    label: str | None = None
    planned_minutes: int = Field(default=25, ge=1, le=180)


class FocusSessionEnd(BaseModel):
    duration_seconds: int = Field(..., ge=0)


class FocusSessionRead(BaseModel):
    id: int
    user_id: int
    label: str | None
    status: str
    planned_minutes: int
    duration_seconds: int
    started_at: datetime
    ended_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


class FocusTodaySummary(BaseModel):
    sessions_today: int = 0
    total_minutes_today: int = 0


class FocusTotalsSummary(BaseModel):
    total_sessions: int = 0
    total_minutes: int = 0
    sessions_today: int = 0
    total_minutes_today: int = 0


# ── DailyScore ────────────────────────────────────────────

class DailyScoreCreate(BaseModel):
    score: int = Field(..., ge=1, le=5)
    note: str | None = Field(default=None, max_length=500)


class DailyScoreRead(BaseModel):
    id: int
    user_id: int
    score_date: str
    score: int
    note: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Stats ─────────────────────────────────────────────────

class TaskStatsRead(BaseModel):
    total: int
    completed_today: int
    completion_rate: float
    encouragement: str = ""


class TotalStatsRead(BaseModel):
    total_tasks: int
    total_completed: int
    completion_rate: float
    encouragement: str = ""


# ── ScoreCard ──────────────────────────────────────────────

class ScoreSubject(BaseModel):
    name: str
    score: float
    credit: float = Field(default=1.0, ge=0)


class ScoreModule(BaseModel):
    name: str
    score: float = 0
    max_score: float = 0
    note: str | None = None


class ScoreCardCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    semester: str | None = None
    subjects: list[ScoreSubject] | None = None
    modules: list[ScoreModule] | None = None
    note: str | None = None


class ScoreCardUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    semester: str | None = None
    subjects: list[ScoreSubject] | None = None
    modules: list[ScoreModule] | None = None
    note: str | None = None


class ScoreCardRead(BaseModel):
    id: int
    user_id: int
    title: str
    semester: str | None
    subjects_json: str
    modules_json: str
    total_score: float | None
    gpa: float | None
    note: str | None
    ai_analysis: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ScoreCardAnalysisRequest(BaseModel):
    card_id: int


# ── Memory ──────────────────────────────────────────────────

class MemoryCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    photo_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    location: str | None = Field(default=None, max_length=200)
    story: str | None = None
    tags: list[str] = Field(default_factory=list)


class MemoryUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    photo_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    location: str | None = Field(default=None, max_length=200)
    story: str | None = None
    tags: list[str] | None = None


class MemoryRead(BaseModel):
    id: int
    user_id: int
    title: str
    photo_date: str | None
    location: str | None
    story: str | None
    tags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    attachment_count: int = 0
    attachments: list[AttachmentRead] = Field(default_factory=list)

    class Config:
        from_attributes = True


# ── Project ─────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    project_type: str | None = Field(default=None, max_length=100)
    start_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    status: str = Field(default="进行中", max_length=20)
    tech_stack: str | None = Field(default=None, max_length=500)
    summary: str | None = None
    link: str | None = Field(default=None, max_length=500)
    achievements: str | None = None
    next_plan: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    project_type: str | None = Field(default=None, max_length=100)
    start_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    status: str | None = Field(default=None, max_length=20)
    tech_stack: str | None = Field(default=None, max_length=500)
    summary: str | None = None
    link: str | None = Field(default=None, max_length=500)
    achievements: str | None = None
    next_plan: str | None = None


class ProjectRead(BaseModel):
    id: int
    user_id: int
    name: str
    project_type: str | None
    start_date: str | None
    status: str
    tech_stack: str | None
    summary: str | None
    link: str | None
    achievements: str | None
    next_plan: str | None
    created_at: datetime
    updated_at: datetime
    attachment_count: int = 0
    attachments: list[AttachmentRead] = Field(default_factory=list)

    class Config:
        from_attributes = True

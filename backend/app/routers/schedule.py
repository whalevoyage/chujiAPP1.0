import logging
import uuid
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlmodel import Session, select

from app.ai_client import call_chat_completion, ocr_config
from app.audit import add_audit_log
from app.config import project_path
from app.database import get_session
from app.deps import get_current_user
from app.models import Course, User, utc_now
from app.schemas import CourseCreate, CourseRead, CourseUpdate, IcsImportResponse

router = APIRouter(prefix="/api/schedule", tags=["schedule"])
logger = logging.getLogger("schedule")

WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
COURSE_COLORS = ["#6B7A5A", "#5A7A6B", "#8B6B5A", "#5A6B8B", "#8B5A7A", "#7A8B5A", "#5A8B8B"]


def get_course_for_user(session: Session, course_id: int, user_id: int) -> Course:
    course = session.get(Course, course_id)
    if course is None or course.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


def _trigger_auto_backup(session: Session, user_id: int) -> None:
    from app.routers.backups import trigger_light_backup

    trigger_light_backup(session, user_id, reason="schedule-change")


# ── CRUD ─────────────────────────────────────────────────────

@router.get("/today", response_model=list[CourseRead])
def get_today_courses(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[Course]:
    today_dow = date.today().weekday()
    return list(
        session.exec(
            select(Course)
            .where(Course.user_id == current_user.id, Course.day_of_week == today_dow)
            .order_by(Course.start_time)
        ).all()
    )


@router.get("/week", response_model=list[CourseRead])
def get_week_courses(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[Course]:
    return list(
        session.exec(
            select(Course)
            .where(Course.user_id == current_user.id)
            .order_by(Course.day_of_week, Course.start_time)
        ).all()
    )


@router.get("/{course_id}", response_model=CourseRead)
def get_course(
    course_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Course:
    return get_course_for_user(session, course_id, current_user.id)


@router.post("", response_model=CourseRead)
def create_course(
    payload: CourseCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Course:
    color = payload.color or COURSE_COLORS[payload.day_of_week % len(COURSE_COLORS)]
    now = utc_now()
    course = Course(
        user_id=current_user.id,
        name=payload.name.strip(),
        teacher=payload.teacher.strip() if payload.teacher else None,
        location=payload.location.strip() if payload.location else None,
        day_of_week=payload.day_of_week,
        start_time=payload.start_time,
        end_time=payload.end_time,
        start_week=payload.start_week or 1,
        end_week=payload.end_week or 16,
        color=color,
        note=payload.note,
        created_at=now,
        updated_at=now,
    )
    session.add(course)
    session.flush()
    add_audit_log(
        session, request=request, action="course.create",
        user_id=current_user.id, detail={"course_id": course.id, "name": course.name},
    )
    session.commit()
    session.refresh(course)
    _trigger_auto_backup(session, current_user.id)
    return course


@router.put("/{course_id}", response_model=CourseRead)
def update_course(
    course_id: int,
    payload: CourseUpdate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Course:
    course = get_course_for_user(session, course_id, current_user.id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if isinstance(value, str) and field in ("name", "teacher", "location"):
            value = value.strip()
        setattr(course, field, value)
    course.updated_at = utc_now()
    session.add(course)
    add_audit_log(
        session, request=request, action="course.update",
        user_id=current_user.id, detail={"course_id": course.id},
    )
    session.commit()
    session.refresh(course)
    return course


@router.delete("/{course_id}")
def delete_course(
    course_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    course = get_course_for_user(session, course_id, current_user.id)
    session.delete(course)
    add_audit_log(
        session, request=request, action="course.delete",
        user_id=current_user.id, detail={"course_id": course_id},
    )
    session.commit()
    _trigger_auto_backup(session, current_user.id)
    return {"ok": True}


# ── ICS 导入 ─────────────────────────────────────────────────

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_PHOTO_SIZE = 10 * 1024 * 1024  # 10 MB


def _parse_time_str(time_obj) -> str | None:
    """Extract HH:MM from an icalendar time object."""
    if time_obj is None:
        return None
    try:
        dt = time_obj.dt
        return dt.strftime("%H:%M")
    except Exception:
        return None


@router.post("/import-ics", response_model=IcsImportResponse)
async def import_ics(
    request: Request,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    """从 .ics 日历文件导入课程。"""
    try:
        import icalendar  # type: ignore[import-untyped]
    except ImportError:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="icalendar 库未安装")

    if not file.filename or not file.filename.lower().endswith((".ics", ".ical")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 .ics / .ical 文件")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件为空")

    try:
        cal = icalendar.Calendar.from_ical(content)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无法解析该日历文件，请确认是标准 .ics 格式")

    imported: list[Course] = []
    now = utc_now()

    for component in cal.walk():
        if component.name != "VEVENT":
            continue

        summary = str(component.get("summary", "")).strip()
        if not summary:
            continue

        dtstart = component.get("dtstart")
        dtend = component.get("dtend")
        if dtstart is None:
            continue

        try:
            start_dt = dtstart.dt
            end_dt = dtend.dt if dtend else start_dt
        except Exception:
            continue

        # 提取 day_of_week (Python: 0=Mon)
        day_of_week = start_dt.weekday()

        start_time = _parse_time_str(dtstart) or "08:00"
        end_time = _parse_time_str(dtend) or "09:30"

        location = str(component.get("location", "")).strip() or None
        description = str(component.get("description", "")).strip() or None
        teacher = str(component.get("organizer", "")).strip() or None

        # 尝试从 description 提取老师和地点
        note_parts = []
        if description:
            for line in description.splitlines():
                line = line.strip()
                if line.startswith("老师") or line.startswith("教师"):
                    teacher = teacher or line.split("：", 1)[-1].split(":", 1)[-1].strip()
                elif line.startswith("地点") or line.startswith("教室"):
                    location = location or line.split("：", 1)[-1].split(":", 1)[-1].strip()
                else:
                    note_parts.append(line)

        color = COURSE_COLORS[day_of_week % len(COURSE_COLORS)]

        course = Course(
            user_id=current_user.id,
            name=summary[:200],
            teacher=teacher[:100] if teacher else None,
            location=location[:200] if location else None,
            day_of_week=day_of_week,
            start_time=start_time,
            end_time=end_time,
            start_week=1,
            end_week=16,
            color=color,
            note="\n".join(note_parts)[:2000] if note_parts else None,
            created_at=now,
            updated_at=now,
        )
        session.add(course)
        imported.append(course)

    if not imported:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未在文件中找到有效课程事件")

    session.flush()
    for c in imported:
        add_audit_log(
            session, request=request, action="course.import_ics",
            user_id=current_user.id, detail={"course_id": c.id, "name": c.name},
        )
    session.commit()
    for c in imported:
        session.refresh(c)

    _trigger_auto_backup(session, current_user.id)

    return {
        "ok": True,
        "imported": len(imported),
        "items": [CourseRead.model_validate(c) for c in imported],
        "error": None,
    }


def _parse_courses_from_ai_text(text: str) -> list[dict]:
    """解析 AI 返回的 JSON/文本，提取课程。
    支持 AI 输出 JSON 数组：[{name, day, periods: [1,2], teacher, location}]
    也容错解析每行「周一 1-2节 课程名 @地点 老师」。
    """
    import json as _json
    import re as _re

    # 尝试 JSON 解析
    try:
        # 截取第一个 JSON 数组
        m = _re.search(r"\[.*\]", text, _re.S)
        if m:
            items = _json.loads(m.group(0))
            results = []
            for it in items:
                if not isinstance(it, dict) or not it.get("name"):
                    continue
                day_raw = it.get("day", "")
                day_map = {"周一": 0, "周二": 1, "周三": 2, "周四": 3, "周五": 4, "周六": 5, "周日": 6,
                           "星期一": 0, "星期二": 1, "星期三": 2, "星期四": 3, "星期五": 4, "星期六": 5, "星期日": 6,
                           "一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6}
                dow = None
                for k, v in day_map.items():
                    if k in str(day_raw):
                        dow = v
                        break
                if dow is None:
                    continue
                periods = it.get("periods") or it.get("period") or []
                if isinstance(periods, (int, str)):
                    periods = [periods]
                periods = [int(_re.sub(r"\D", "", str(p)) or 0) for p in periods if str(p).strip()]
                periods = [p for p in periods if 1 <= p <= 12]
                if not periods:
                    continue
                results.append({
                    "name": str(it["name"])[:200],
                    "day_of_week": dow,
                    "period_start": min(periods),
                    "period_end": max(periods),
                    "teacher": str(it.get("teacher") or "")[:100] or None,
                    "location": str(it.get("location") or "")[:200] or None,
                })
            return results
    except Exception:
        pass
    return []


@router.post("/import-photo")
async def import_photo(
    request: Request,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    """上传课表照片，调用 AI 视觉模型自动识别并尽量自动填入课表。

    需在 .env 或设置页配置 OCR_*，未单独配置时复用 AI_*。
    未配置时仅保存图片并返回友好提示。
    """
    from app.config import get_settings

    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未选择文件")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 JPG / PNG / WebP 图片")

    content = await file.read()
    if len(content) > MAX_PHOTO_SIZE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"图片大小不能超过 {MAX_PHOTO_SIZE // 1024 // 1024} MB")

    if len(content) < 64:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="图片内容过小或无效")

    # 保存到 data/attachments/schedule_photos/
    photos_dir = project_path("data", "attachments", "schedule_photos")
    photos_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{current_user.id}_{uuid.uuid4().hex[:12]}{ext}"
    stored_path = photos_dir / stored_name
    stored_path.write_bytes(content)

    settings = get_settings()
    config = ocr_config(settings)

    add_audit_log(
        session, request=request, action="course.import_photo",
        user_id=current_user.id, detail={"stored_path": str(stored_path), "ocr_enabled": config.configured},
    )

    # 未配置 OCR Key：友好提示，不报错
    if not config.configured:
        session.commit()
        return {
            "ok": True,
            "message": "图片已保存。请先配置 OCR Key（可在「我的 → API Key 配置」中填写）。",
            "imported": 0,
            "items": [],
        }

    # 检查模型是否支持图片识别
    from app.ai_client import is_vision_model

    if not is_vision_model(config.model):
        session.commit()
        return {
            "ok": True,
            "message": "当前模型不支持图片识别，请更换支持视觉识别的模型（如 gpt-4o、claude-sonnet、gemini-2-flash 等）。",
            "imported": 0,
            "items": [],
        }

    # 调用 AI 视觉模型
    import base64

    b64 = base64.b64encode(content).decode("ascii")
    mime = "image/jpeg" if ext in (".jpg", ".jpeg") else f"image/{ext.lstrip('.')}"
    prompt = (
        "请识别这张大学课表图片，输出严格的 JSON 数组（不要任何额外文字、不要代码块标记），"
        "每个元素：{\"name\":\"课程名\",\"day\":\"周一/周二/...\",\"periods\":[节次1,节次2],"
        "\"teacher\":\"老师\",\"location\":\"教室\"}。节次是 1-12 的数字。"
        "如果识别不出某字段就给空字符串。只输出 JSON 数组本身。"
    )
    try:
        ai_text = call_chat_completion(
            config,
            [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                ],
            }],
            temperature=0.1,
            max_tokens=1500,
            timeout=60.0,
            failure_message="OCR 识别失败，可手动添加课程。",
        )
    except HTTPException:
        logger.warning("OCR 识别失败（AI 调用异常），model=%s", config.model)
        session.commit()
        return {
            "ok": True,
            "message": "OCR 识别失败，可手动添加课程。",
            "imported": 0,
            "items": [],
        }

    parsed = _parse_courses_from_ai_text(ai_text)
    if not parsed:
        session.commit()
        return {
            "ok": True,
            "message": "OCR 识别失败，可手动添加课程。",
            "imported": 0,
            "items": [],
        }

    # 节次时间表（与前端一致）
    PERIODS = [
        ("08:00", "08:45"), ("08:55", "09:40"), ("10:00", "10:45"), ("10:55", "11:40"),
        ("13:30", "14:15"), ("14:25", "15:10"), ("15:30", "16:15"), ("16:25", "17:10"),
        ("17:30", "18:15"), ("18:15", "19:00"), ("19:30", "20:15"), ("20:15", "21:00"),
    ]
    now = utc_now()
    imported: list[Course] = []
    for item in parsed:
        ps = max(1, min(12, item["period_start"]))
        pe = max(1, min(12, item["period_end"]))
        if pe < ps:
            ps, pe = pe, ps
        start_time = PERIODS[ps - 1][0]
        end_time = PERIODS[pe - 1][1]
        course = Course(
            user_id=current_user.id,
            name=item["name"][:200],
            teacher=item.get("teacher"),
            location=item.get("location"),
            day_of_week=item["day_of_week"],
            start_time=start_time,
            end_time=end_time,
            start_week=1,
            end_week=16,
            color=COURSE_COLORS[item["day_of_week"] % len(COURSE_COLORS)],
            created_at=now,
            updated_at=now,
        )
        session.add(course)
        imported.append(course)

    session.flush()
    for c in imported:
        add_audit_log(
            session, request=request, action="course.import_photo_ocr",
            user_id=current_user.id, detail={"course_id": c.id, "name": c.name},
        )
    session.commit()
    for c in imported:
        session.refresh(c)

    _trigger_auto_backup(session, current_user.id)

    from app.schemas import CourseRead
    return {
        "ok": True,
        "message": f"识别成功，已自动导入 {len(imported)} 门课程。",
        "imported": len(imported),
        "items": [CourseRead.model_validate(c).model_dump() for c in imported],
    }


@router.post("/auto-backup")
def trigger_auto_backup(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    _trigger_auto_backup(session, current_user.id)
    return {"ok": True}

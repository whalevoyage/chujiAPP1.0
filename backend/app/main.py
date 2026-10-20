from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings, project_path
from app.database import init_db
from app.routers import admin, attachments, auth, backups, data_center, diary, focus, honors, memories, plans, projects, reviews, schedule, scores, settings as settings_router, tasks, weaknesses, weather


settings = get_settings()

FRONTEND_DIST = project_path("frontend", "dist")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """注入安全响应头，防范常见 Web 攻击"""

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        # 不设 HSTS：当前无 HTTPS
        return response


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="初记 API",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

# 安全头（最先添加，确保所有响应都携带）
app.add_middleware(SecurityHeadersMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://127.0.0.1:8788", "http://localhost", "http://localhost:5173", "capacitor://localhost"],
    allow_origin_regex=r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(plans.router)
app.include_router(plans.steps_router)
app.include_router(plans.reminders_router)
app.include_router(tasks.router)
app.include_router(diary.router)
app.include_router(diary.tags_router)
app.include_router(weaknesses.router)
app.include_router(weaknesses.actions_router)
app.include_router(reviews.router)
app.include_router(honors.router)
app.include_router(attachments.router)
app.include_router(backups.router)
app.include_router(backups.exports_router)
app.include_router(schedule.router)
app.include_router(focus.router)
app.include_router(focus.daily_score_router)
app.include_router(focus.daily_reminder_router)
app.include_router(weather.router)
app.include_router(settings_router.router)
app.include_router(scores.router)
app.include_router(memories.router)
app.include_router(projects.router)
app.include_router(data_center.router)


@app.get("/health", tags=["system"])
def health() -> dict[str, object]:
    data_dir = project_path("data")
    attachments_dir = project_path("data", "attachments")
    exports_dir = project_path("data", "exports")
    backups_dir = project_path("backups")
    logs_dir = project_path("logs")
    return {
        "status": "ok",
        "app": settings.app_name,
        "environment": settings.app_env,
        "time": datetime.now(UTC).isoformat(),
        "storage": {
            "data": data_dir.exists(),
            "attachments": attachments_dir.exists(),
            "exports": exports_dir.exists(),
            "backups": backups_dir.exists(),
            "logs": logs_dir.exists(),
        },
    }


# 托管前端静态文件（手机独立运行时使用，API 路由优先）
if FRONTEND_DIST.exists() and (FRONTEND_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings, project_path
from app.database import init_db
from app.logging_config import configure_application_logging
from app.version import APP_VERSION
from app.routers import admin, attachments, auth, backups, data_center, diary, focus, honors, memories, plans, projects, reviews, schedule, scores, settings as settings_router, tasks, weaknesses, weather


settings = get_settings()
logger = configure_application_logging(production=settings.app_env.strip().lower() in {"prod", "production"})

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
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
            "form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https: capacitor://localhost; font-src 'self' data:; "
            "connect-src 'self' https: http://localhost:* http://127.0.0.1:* capacitor://localhost; "
            "worker-src 'self' blob:; manifest-src 'self'"
        )
        if settings.app_env.strip().lower() in {"prod", "production"} and settings.session_cookie_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("application startup version=%s environment=%s", APP_VERSION, settings.app_env)
    init_db()
    yield


app = FastAPI(
    title="初记 API",
    version=APP_VERSION,
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://127.0.0.1:8788", "http://localhost", "http://localhost:5173", "capacitor://localhost"],
    allow_origin_regex=r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)

# 外层响应头中间件也会覆盖 CORS 中间件直接返回的预检响应。
app.add_middleware(SecurityHeadersMiddleware)

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
    result: dict[str, object] = {
        "status": "ok",
        "version": APP_VERSION,
        "time": datetime.now(UTC).isoformat(),
    }
    if settings.app_env.strip().lower() in {"prod", "production"}:
        return result

    data_dir = project_path("data")
    attachments_dir = project_path("data", "attachments")
    exports_dir = project_path("data", "exports")
    backups_dir = project_path("backups")
    logs_dir = project_path("logs")
    result.update(
        {
            "app": settings.app_name,
            "environment": settings.app_env,
            "storage": {
            "data": data_dir.exists(),
            "attachments": attachments_dir.exists(),
            "exports": exports_dir.exists(),
            "backups": backups_dir.exists(),
            "logs": logs_dir.exists(),
            },
        }
    )
    return result


# 托管前端静态文件（手机独立运行时使用，API 路由优先）
if FRONTEND_DIST.exists() and (FRONTEND_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

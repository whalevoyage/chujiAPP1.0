from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    app_name: str = "初记"
    app_env: str = "local"
    app_host: str = "127.0.0.1"
    app_port: int = 8788
    frontend_origin: str = "http://127.0.0.1:8787"
    database_url: str = "sqlite:///../data/personal_vault.db"
    session_cookie_name: str = "personal_vault_session"
    session_secret: str = ""
    session_cookie_secure: bool = False
    session_max_age_seconds: int = 60 * 60 * 24 * 30
    initial_admin_username: str = "admin"
    initial_admin_password: str = ""
    initial_delete_password: str = ""
    ai_base_url: str = ""
    ai_api_key: str = ""
    ai_model: str = ""
    # Weather region is selected by each user in the app.
    weather_api_key: str = ""
    weather_api_host: str = ""  # QWeather API host, for example xxxxx.qweatherapi.com
    weather_location: str = ""  # Optional longitude,latitude
    weather_location_name: str = ""
    # OCR（课表拍照识别，兼容视觉模型；未单独配置时复用 AI 配置）
    ocr_api_key: str = ""
    ocr_base_url: str = ""
    ocr_model: str = ""

    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


def project_path(*parts: str) -> Path:
    return PROJECT_ROOT.joinpath(*parts)

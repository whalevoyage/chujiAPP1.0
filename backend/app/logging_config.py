import logging
from logging.handlers import RotatingFileHandler

from app.config import project_path


def configure_application_logging(*, production: bool) -> logging.Logger:
    logger = logging.getLogger("chuji")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not production or logger.handlers:
        return logger

    try:
        log_directory = project_path("logs")
        log_directory.mkdir(parents=True, exist_ok=True)
        handler: logging.Handler = RotatingFileHandler(
            log_directory / "application.log",
            maxBytes=10 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
    except OSError:
        handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(handler)
    return logger

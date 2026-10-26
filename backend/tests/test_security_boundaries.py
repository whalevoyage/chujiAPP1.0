import json
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.models import AuditLog, BackupRecord, DiaryEntry
from app import ai_client
from app.routers import attachments, backups, settings as settings_router


@pytest.fixture
def isolated_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    backup_dir = tmp_path / "backups"
    data_dir = tmp_path / "data"
    attachments_dir = data_dir / "attachments"
    exports_dir = data_dir / "exports"
    for directory in (backup_dir, attachments_dir, exports_dir):
        directory.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(backups, "BACKUPS_DIR", backup_dir)
    monkeypatch.setattr(backups, "DATA_DIR", data_dir)
    monkeypatch.setattr(backups, "DB_PATH", data_dir / "personal_vault.db")
    monkeypatch.setattr(backups, "ATTACHMENTS_DIR", attachments_dir)
    monkeypatch.setattr(backups, "EXPORTS_DIR", exports_dir)
    monkeypatch.setattr(backups, "README_PATH", tmp_path / "README.md")
    monkeypatch.setattr(backups, "NOTICE_PATH", tmp_path / "NOTICE.md")
    monkeypatch.setattr(settings_router, "ENV_PATH", tmp_path / ".env")
    monkeypatch.setattr(attachments, "DELETE_PASSWORD_FILE", data_dir / "delete_password.key")
    return tmp_path


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("get", "/api/backups", None),
        ("post", "/api/backups/create", None),
        ("post", "/api/backups/auto-daily", None),
        ("post", "/api/backups/light", None),
        ("post", "/api/backups/1/restore", {"password": "delete-secret"}),
        ("delete", "/api/backups/1", {"password": "delete-secret"}),
    ],
)
def test_non_admin_cannot_use_system_backup_routes(client, user_headers, method, path, payload):
    response = client.request(method.upper(), path, headers=user_headers, json=payload)
    assert response.status_code == status_code_for_forbidden()


def status_code_for_forbidden() -> int:
    return 403


def test_non_admin_cannot_read_or_change_global_settings(client, user_headers, isolated_storage):
    get_response = client.get("/api/settings/api-keys", headers=user_headers)
    update_response = client.put(
        "/api/settings/api-keys",
        headers=user_headers,
        json={"ai_api_key": "must-not-be-written"},
    )
    delete_status_response = client.get("/api/settings/delete-password", headers=user_headers)
    delete_change_response = client.put(
        "/api/settings/delete-password",
        headers=user_headers,
        json={"old_password": "", "new_password": "New-delete-123!"},
    )

    assert [
        get_response.status_code,
        update_response.status_code,
        delete_status_response.status_code,
        delete_change_response.status_code,
    ] == [403, 403, 403, 403]
    assert not (isolated_storage / ".env").exists()
    assert not (isolated_storage / "data" / "delete_password.key").exists()


def test_admin_can_read_global_settings(client, admin_headers):
    response = client.get("/api/settings/api-keys", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["ai_api_key"]["configured"] is False


def test_admin_can_create_system_backup(client, admin_headers, isolated_storage):
    response = client.post("/api/backups/create", headers=admin_headers)
    assert response.status_code == 200
    record = response.json()
    assert record["status"] == "success"
    assert Path(isolated_storage / "backups" / record["filename"]).exists()


def test_non_admin_cannot_trigger_automatic_backups_from_internal_flows(
    test_engine,
    isolated_storage,
):
    with Session(test_engine) as session:
        assert backups.maybe_create_daily_auto_backup(session, request=None, user_id=2) is None
        assert backups.trigger_light_backup(session, 2, request=None, reason="test") is None
        assert session.exec(select(BackupRecord)).all() == []


def test_ai_and_ocr_remote_urls_must_use_https(client, admin_headers):
    response = client.put(
        "/api/settings/api-keys",
        headers=admin_headers,
        json={"ai_base_url": "http://provider.example/v1"},
    )
    assert response.status_code == 400
    assert "HTTPS" in response.json()["detail"]


def test_local_http_provider_url_is_development_only(monkeypatch):
    monkeypatch.setattr(settings_router, "get_settings", lambda: SimpleNamespace(app_env="production"))
    with pytest.raises(HTTPException) as error:
        settings_router.validate_provider_url("AI_BASE_URL", "http://localhost:8000/v1")
    assert getattr(error.value, "status_code", None) == 400
    settings_router.validate_provider_url("AI_BASE_URL", "https://provider.example/v1")


def test_provider_url_rejects_embedded_credentials():
    with pytest.raises(HTTPException) as error:
        settings_router.validate_provider_url("AI_BASE_URL", "https://user:secret@provider.example/v1")
    assert error.value.status_code == 400


def test_model_client_rejects_insecure_or_secret_bearing_provider_urls(monkeypatch):
    monkeypatch.setattr(ai_client, "get_settings", lambda: SimpleNamespace(app_env="production"))
    for base_url in (
        "http://provider.example/v1",
        "https://user:secret@provider.example/v1",
        "https://provider.example/v1?key=secret",
    ):
        with pytest.raises(HTTPException) as error:
            ai_client.call_chat_completion(ai_client.ChatConfig(base_url, "test-key", "test-model"), [])
        assert error.value.status_code == 400

    ai_client.validate_chat_base_url("http://localhost:8000/v1", app_env="development")


def test_admin_restore_requires_independent_password_and_audits_failure(
    client,
    admin_headers,
    test_engine,
    isolated_storage,
):
    backup_path = isolated_storage / "backups" / "system.zip"
    backup_path.write_bytes(b"not opened because reauthentication fails")
    with Session(test_engine) as session:
        session.add(
            BackupRecord(
                created_by_user_id=1,
                file_path=str(backup_path),
                size=backup_path.stat().st_size,
                sha256="unused-on-reauth-failure",
                status="success",
            )
        )
        session.commit()

    attachments._write_delete_password("Restore-test-123!")
    response = client.post(
        "/api/backups/1/restore",
        headers=admin_headers,
        json={"password": "wrong-password"},
    )

    assert response.status_code == 403
    with Session(test_engine) as session:
        audit = session.exec(
            select(AuditLog).where(AuditLog.action == "backup.restore_failed")
        ).first()
        assert audit is not None
        assert audit.user_id == 1
        detail = json.loads(audit.detail or "{}")
        assert detail["backup_id"] == 1
        assert detail["filename"] == "system.zip"
        assert detail["success"] is False
        assert detail["error_reason"] == "reauthentication_failed"
        assert audit.ip
        assert audit.user_agent


def test_restore_rejects_backup_sha256_mismatch_and_audits(client, admin_headers, test_engine, isolated_storage):
    backup_path = isolated_storage / "backups" / "mismatch.zip"
    write_user_backup(backup_path)
    with Session(test_engine) as session:
        session.add(
            BackupRecord(
                created_by_user_id=1,
                file_path=str(backup_path),
                size=backup_path.stat().st_size,
                sha256="0" * 64,
                status="success",
            )
        )
        session.commit()
    attachments._write_delete_password("Restore-test-123!")

    response = client.post(
        "/api/backups/1/restore",
        headers=admin_headers,
        json={"password": "Restore-test-123!"},
    )

    assert response.status_code == 400
    with Session(test_engine) as session:
        assert len(session.exec(select(BackupRecord)).all()) == 1
        audit = session.exec(select(AuditLog).where(AuditLog.action == "backup.restore_failed")).first()
        assert audit is not None
        assert json.loads(audit.detail or "{}")["error_reason"] == "Backup sha256 mismatch"


def write_user_backup(path: Path, database: bytes = b"sqlite") -> None:
    manifest = json.dumps({"source": backups.MANIFEST_SOURCE, "format_version": backups.MANIFEST_VERSION})
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("data/personal_vault.db", database)
        archive.writestr(backups.MANIFEST_NAME, manifest)


def test_backup_zip_rejects_path_traversal(tmp_path: Path):
    path = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("data/personal_vault.db", b"sqlite")
        archive.writestr(backups.MANIFEST_NAME, json.dumps({"source": backups.MANIFEST_SOURCE, "format_version": backups.MANIFEST_VERSION}))
        archive.writestr("data/../../outside.txt", b"unsafe")

    with pytest.raises(HTTPException) as error:
        backups.validate_backup_zip(path)
    assert error.value.status_code == 400


def test_backup_zip_rejects_excessive_expanded_size(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    path = tmp_path / "large.zip"
    write_user_backup(path, database=b"\0" * 4096)
    monkeypatch.setattr(backups, "MAX_BACKUP_UNCOMPRESSED_SIZE", 1024)

    with pytest.raises(HTTPException) as error:
        backups.validate_backup_zip(path)
    assert error.value.status_code == 413


def test_backup_zip_rejects_excessive_compression_ratio(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    path = tmp_path / "compressed.zip"
    write_user_backup(path, database=b"\0" * 4096)
    monkeypatch.setattr(backups, "MAX_BACKUP_COMPRESSION_RATIO", 10)

    with pytest.raises(HTTPException) as error:
        backups.validate_backup_zip(path)
    assert error.value.status_code == 413


def test_directory_restore_failure_restores_every_previous_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    data_dir = tmp_path / "data"
    backup_dir = tmp_path / "backups"
    attachment_dir = data_dir / "attachments"
    export_dir = data_dir / "exports"
    backup_dir.mkdir()
    attachment_dir.mkdir(parents=True)
    export_dir.mkdir()
    database_path = data_dir / "personal_vault.db"
    database_path.write_bytes(b"old-db")
    (attachment_dir / "old.txt").write_text("old attachment", encoding="utf-8")
    (export_dir / "old.txt").write_text("old export", encoding="utf-8")

    monkeypatch.setattr(backups, "BACKUPS_DIR", backup_dir)
    monkeypatch.setattr(backups, "DB_PATH", database_path)
    monkeypatch.setattr(backups, "ATTACHMENTS_DIR", attachment_dir)
    monkeypatch.setattr(backups, "EXPORTS_DIR", export_dir)

    extracted = tmp_path / "extracted"
    restored_data = extracted / "data"
    (restored_data / "attachments").mkdir(parents=True)
    (restored_data / "attachments" / "new.txt").write_text("new attachment", encoding="utf-8")
    (restored_data / "personal_vault.db").write_bytes(b"new-db")
    # A file where the exports directory should be makes the second replacement fail.
    (restored_data / "exports").write_text("invalid directory", encoding="utf-8")

    with pytest.raises(OSError):
        backups.restore_files_from_extracted(extracted)

    assert database_path.read_bytes() == b"old-db"
    assert (attachment_dir / "old.txt").read_text(encoding="utf-8") == "old attachment"
    assert (export_dir / "old.txt").read_text(encoding="utf-8") == "old export"


def test_admin_can_set_delete_password_when_none_exists(client, admin_headers, isolated_storage):
    response = client.put(
        "/api/settings/delete-password",
        headers=admin_headers,
        json={"old_password": "", "new_password": "First-delete-123!"},
    )

    assert response.status_code == 200
    stored = (isolated_storage / "data" / "delete_password.key").read_text(encoding="utf-8")
    assert stored.startswith(("$2a$", "$2b$", "$2y$"))
    assert stored != "First-delete-123!"


def test_legacy_plaintext_delete_password_migrates_after_valid_use(isolated_storage):
    password_file = isolated_storage / "data" / "delete_password.key"
    password_file.write_text("Legacy-delete-123!", encoding="utf-8")

    assert attachments.verify_delete_password("Legacy-delete-123!") is True
    migrated = password_file.read_text(encoding="utf-8")
    assert migrated.startswith(("$2a$", "$2b$", "$2y$"))
    assert migrated != "Legacy-delete-123!"
    assert attachments.verify_delete_password("Legacy-delete-123!") is True


def test_ordinary_user_json_export_contains_only_own_records(client, user_headers, test_engine, isolated_storage):
    with Session(test_engine) as session:
        session.add_all(
            [
                DiaryEntry(user_id=2, title="private-a", content_md="A", entry_date="2026-10-21"),
                DiaryEntry(user_id=3, title="private-b", content_md="B", entry_date="2026-10-21"),
            ]
        )
        session.commit()

    response = client.get("/api/exports/json", headers=user_headers)
    assert response.status_code == 200
    exported = json.loads(response.content)
    titles = {entry["title"] for entry in exported["diary_entries"]}
    assert titles == {"private-a"}

    admin_all = client.get("/api/exports/json?admin_all=true", headers=user_headers)
    assert admin_all.status_code == 403

from pathlib import Path
from types import SimpleNamespace


def test_production_health_exposes_only_minimal_status_and_version(client, monkeypatch):
    from app import main

    monkeypatch.setattr(
        main,
        "settings",
        SimpleNamespace(app_env="production", session_cookie_secure=True, app_name="hidden"),
    )
    response = client.get("/health")

    assert response.status_code == 200
    assert set(response.json()) == {"status", "version", "time"}
    assert response.json()["version"] == (Path(__file__).resolve().parents[2] / "VERSION").read_text(encoding="utf-8").strip()
    assert response.headers["strict-transport-security"] == "max-age=31536000"
    assert "default-src 'self'" in response.headers["content-security-policy"]
    assert response.headers["x-content-type-options"] == "nosniff"


def test_development_health_keeps_storage_diagnostics_without_hsts(client, monkeypatch):
    from app import main

    monkeypatch.setattr(
        main,
        "settings",
        SimpleNamespace(app_env="development", session_cookie_secure=False, app_name="初记"),
    )
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["storage"]
    assert response.json()["environment"] == "development"
    assert "strict-transport-security" not in response.headers


def test_cors_preflight_also_receives_security_headers(client):
    response = client.options(
        "/api/auth/me",
        headers={
            "Origin": "http://127.0.0.1:8787",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["content-security-policy"]
    assert response.headers["x-frame-options"] == "DENY"

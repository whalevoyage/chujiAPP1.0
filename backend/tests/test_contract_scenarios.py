import json
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile


SCENARIOS = json.loads(
    (Path(__file__).resolve().parents[2] / "contracts" / "core-growth-scenarios.json").read_text(encoding="utf-8")
)


def test_remote_plan_step_progress_matches_local_api_contract(client, user_headers):
    scenario = SCENARIOS["planProgress"]
    expected = scenario["expected"]
    plan_response = client.post(
        "/api/plans",
        headers=user_headers,
        json=scenario["plan"],
    )
    assert plan_response.status_code == 200
    plan = plan_response.json()
    assert plan["progress"] == expected["initial_progress"]

    step_response = client.post(
        f"/api/plans/{plan['id']}/steps",
        headers=user_headers,
        json=scenario["step"],
    )
    assert step_response.status_code == 200
    step = step_response.json()
    assert step["status"] == expected["step_status"]

    complete_response = client.post(
        f"/api/plan-steps/{step['id']}/complete",
        headers=user_headers,
    )
    assert complete_response.status_code == 200
    updated_plan = client.get(f"/api/plans/{plan['id']}", headers=user_headers).json()

    assert updated_plan["progress"] == expected["completed_progress"]
    assert updated_plan["completed_steps"] == expected["completed_steps"]
    assert updated_plan["status"] == expected["plan_status"]


def test_remote_task_checkin_stats_match_local_api_contract(client, user_headers):
    scenario = SCENARIOS["taskCheckin"]
    expected = scenario["expected"]
    task_response = client.post("/api/tasks", headers=user_headers, json=scenario["task"])
    assert task_response.status_code == 200
    task = task_response.json()

    checkin_response = client.post(
        f"/api/tasks/{task['id']}/checkin",
        headers=user_headers,
        json=scenario["checkin"],
    )
    assert checkin_response.status_code == 200
    assert checkin_response.json()["status"] == expected["checkin_status"]

    stats = client.get("/api/tasks/stats", headers=user_headers).json()
    assert stats["total"] == expected["total_tasks"]
    assert stats["completed_today"] == expected["completed_today"]


def test_remote_weakness_action_review_matches_local_contract(client, user_headers):
    scenario = SCENARIOS["weaknessActionReview"]
    expected = scenario["expected"]
    weakness_response = client.post("/api/weaknesses", headers=user_headers, json=scenario["weakness"])
    assert weakness_response.status_code == 200
    weakness = weakness_response.json()

    action_response = client.post(
        f"/api/weaknesses/{weakness['id']}/actions",
        headers=user_headers,
        json=scenario["action"],
    )
    assert action_response.status_code == 200
    action = action_response.json()

    complete_response = client.post(f"/api/improvement-actions/{action['id']}/complete", headers=user_headers)
    assert complete_response.status_code == 200
    review_response = client.post(
        "/api/reviews/generate-local-summary",
        headers=user_headers,
        json=scenario["review"],
    )
    assert review_response.status_code == 200
    summary = review_response.json()["summary"]

    assert summary["weakness_count"] == expected["weakness_count"]
    assert len(summary["completed_actions"]) == expected["completed_actions"]
    assert len(summary["unfinished_actions"]) == expected["unfinished_actions"]


def test_remote_score_card_weighting_matches_local_contract(client, user_headers):
    scenario = SCENARIOS["scoreCard"]
    response = client.post("/api/scores", headers=user_headers, json=scenario["score"])

    assert response.status_code == 200
    assert response.json()["total_score"] == scenario["expected"]["total_score"]


def test_remote_honor_attachment_zip_export_matches_local_contract(client, user_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_router
    from app.routers import backups as backups_router

    scenario = SCENARIOS["honorAttachment"]
    expected = scenario["expected"]
    attachment_dir = tmp_path / "attachments"
    monkeypatch.setattr(attachments_router, "ATTACHMENTS_DIR", attachment_dir)
    monkeypatch.setattr(backups_router, "ATTACHMENTS_DIR", attachment_dir)
    monkeypatch.setattr(backups_router, "EXPORTS_DIR", tmp_path / "exports")

    honor_response = client.post("/api/honors", headers=user_headers, json=scenario["honor"])
    assert honor_response.status_code == 200
    honor = honor_response.json()
    upload_response = client.post(
        "/api/attachments/upload",
        headers=user_headers,
        data={"owner_type": "honor", "owner_id": str(honor["id"])},
        files={"file": (scenario["attachment"]["filename"], scenario["attachment"]["content"].encode(), scenario["attachment"]["mime_type"])},
    )
    assert upload_response.status_code == 200
    attachment = upload_response.json()

    archive_response = client.get("/api/exports/zip", headers=user_headers)
    assert archive_response.status_code == 200
    with ZipFile(BytesIO(archive_response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        attachment_manifest = next(item for item in manifest["attachment_files"] if item["attachment_id"] == attachment["id"])
        exported_file = archive.read(attachment_manifest["archive_path"])
        exported_json = json.loads(archive.read("export.json"))

    assert exported_file.decode() == expected["content"]
    assert attachment_manifest["filename"] == expected["filename"]
    assert attachment_manifest["size"] == len(expected["content"].encode())
    assert any(item["id"] == honor["id"] for item in exported_json["honors"])

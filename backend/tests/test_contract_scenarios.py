import json
from pathlib import Path


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

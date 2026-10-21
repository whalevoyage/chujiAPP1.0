def test_remote_plan_step_progress_matches_local_api_contract(client, user_headers):
    plan_response = client.post(
        "/api/plans",
        headers=user_headers,
        json={"plan_date": "2026-10-21", "title": "复习线性代数"},
    )
    assert plan_response.status_code == 200
    plan = plan_response.json()
    assert plan["progress"] == 0

    step_response = client.post(
        f"/api/plans/{plan['id']}/steps",
        headers=user_headers,
        json={"title": "完成习题", "start_time": "09:00", "end_time": "10:00"},
    )
    assert step_response.status_code == 200
    step = step_response.json()
    assert step["status"] == "pending"

    complete_response = client.post(
        f"/api/plan-steps/{step['id']}/complete",
        headers=user_headers,
    )
    assert complete_response.status_code == 200
    updated_plan = client.get(f"/api/plans/{plan['id']}", headers=user_headers).json()

    assert updated_plan["progress"] == 1
    assert updated_plan["completed_steps"] == 1
    assert updated_plan["status"] == "completed"


def test_remote_task_checkin_stats_match_local_api_contract(client, user_headers):
    task_response = client.post("/api/tasks", headers=user_headers, json={"title": "阅读专业书"})
    assert task_response.status_code == 200
    task = task_response.json()

    checkin_response = client.post(
        f"/api/tasks/{task['id']}/checkin",
        headers=user_headers,
        json={"minutes": 25},
    )
    assert checkin_response.status_code == 200
    assert checkin_response.json()["status"] == "completed"

    stats = client.get("/api/tasks/stats", headers=user_headers).json()
    assert stats["total"] == 1
    assert stats["completed_today"] == 1

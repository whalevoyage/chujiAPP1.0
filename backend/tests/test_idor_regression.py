import pytest
from sqlmodel import Session

from app.models import (
    Attachment,
    Course,
    DailyPlan,
    DailyScore,
    DiaryEntry,
    FocusSession,
    Honor,
    ImprovementAction,
    Memory,
    PlanStep,
    Project,
    ReviewReport,
    ScoreCard,
    Tag,
    TagLink,
    Task,
    TaskLog,
    WeaknessRecord,
)


@pytest.fixture
def other_users_records(test_engine):
    with Session(test_engine) as session:
        rows = [
            DailyPlan(id=101, user_id=2, plan_date="2026-10-21", title="A plan"),
            PlanStep(id=102, user_id=2, plan_id=101, title="A step", start_time="09:00", end_time="10:00"),
            Task(id=103, user_id=2, title="A task"),
            TaskLog(id=104, user_id=2, task_id=103, log_date="2026-10-21"),
            DiaryEntry(id=105, user_id=2, title="A diary", content_md="private", entry_date="2026-10-21"),
            Tag(id=106, user_id=2, name="A tag"),
            TagLink(id=107, user_id=2, tag_id=106, target_type="diary", target_id=105),
            WeaknessRecord(
                id=108,
                user_id=2,
                title="A weakness",
                occur_date="2026-10-21",
                behavior="private",
            ),
            ImprovementAction(id=109, user_id=2, weakness_id=108, title="A action"),
            ReviewReport(
                id=110,
                user_id=2,
                report_type="weekly",
                start_date="2026-10-19",
                end_date="2026-10-25",
            ),
            Honor(id=111, user_id=2, title="A honor", honor_type="award"),
            Attachment(
                id=112,
                user_id=2,
                owner_type="honor",
                owner_id=111,
                filename="private.pdf",
                stored_path="private.pdf",
                size=1,
                sha256="0" * 64,
            ),
            Memory(id=113, user_id=2, title="A memory"),
            Project(id=114, user_id=2, name="A project"),
            Course(
                id=115,
                user_id=2,
                name="A course",
                day_of_week=0,
                start_time="09:00",
                end_time="10:00",
            ),
            ScoreCard(id=116, user_id=2, title="A score", subjects_json="[]"),
            FocusSession(id=117, user_id=2, label="A focus"),
            DailyScore(id=118, user_id=2, score_date="2026-10-21", score=5),
        ]
        session.add_all(rows)
        session.commit()


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("GET", "/api/plans/101", None),
        ("PUT", "/api/plan-steps/102", {"title": "hijack"}),
        ("GET", "/api/tasks/103", None),
        ("POST", "/api/tasks/103/checkin", {}),
        ("GET", "/api/diary/105", None),
        ("GET", "/api/weaknesses/108", None),
        ("GET", "/api/weaknesses/108/actions", None),
        ("PUT", "/api/improvement-actions/109", {"title": "hijack"}),
        ("GET", "/api/reviews/110", None),
        ("GET", "/api/honors/111", None),
        ("GET", "/api/attachments/112", None),
        ("GET", "/api/memories/113", None),
        ("GET", "/api/projects/114", None),
        ("GET", "/api/schedule/115", None),
        ("PUT", "/api/scores/116", {"title": "hijack"}),
        ("POST", "/api/focus/117/end", {"duration_seconds": 60}),
    ],
)
def test_foreign_resource_ids_never_cross_user_boundary(
    client,
    other_users_records,
    method,
    path,
    payload,
):
    response = client.request(method, path, headers={"x-test-user-id": "3"}, json=payload)
    assert response.status_code == 404, response.text


def test_user_scoped_tag_and_aggregate_reads_do_not_leak(client, other_users_records):
    headers = {"x-test-user-id": "3"}
    assert client.get("/api/tags", headers=headers).json() == []
    assert client.get("/api/diary", headers=headers).json() == []
    assert client.get("/api/data-center/stats", headers=headers).json()["total_honors"] == 0
    timeline = client.get("/api/timeline", headers=headers).json()
    assert all(event["title"] != "A memory" for event in timeline)

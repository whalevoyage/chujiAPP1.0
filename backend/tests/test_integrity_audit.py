from sqlmodel import Session

from app.integrity_audit import audit_relationship_integrity
from app.models import Attachment, PlanStep, TaskLog


def test_integrity_audit_reports_orphans_without_reading_row_contents(test_engine):
    with Session(test_engine) as session:
        session.add_all(
            [
                PlanStep(user_id=2, plan_id=9001, title="orphan", start_time="09:00", end_time="10:00"),
                TaskLog(user_id=2, task_id=9002, log_date="2026-10-21", status="completed"),
                Attachment(
                    user_id=2,
                    owner_type="honor",
                    owner_id=9003,
                    filename="private.pdf",
                    stored_path="private.pdf",
                    mime_type="application/pdf",
                    size=10,
                    sha256="0" * 64,
                ),
            ]
        )
        session.commit()

    report = audit_relationship_integrity(test_engine)

    assert report["status"] == "orphans_found"
    assert report["orphan_counts"]["plan_steps.plan_id -> daily_plans.id"] == 1
    assert report["orphan_counts"]["task_logs.task_id -> tasks.id"] == 1
    assert report["orphan_counts"]["attachments.owner_id[honor] -> honors.id"] == 1
    assert "private.pdf" not in str(report)


def test_integrity_audit_reports_clean_empty_relationships(test_engine):
    report = audit_relationship_integrity(test_engine)
    assert report["status"] == "clean"
    assert report["orphan_counts"] == {}

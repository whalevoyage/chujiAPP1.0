"""综测成绩 — 录入、计算、AI 分析"""
import json

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlmodel import Session, select

from app.ai_client import ai_config, call_chat_completion, require_config
from app.audit import add_audit_log
from app.config import get_settings
from app.database import get_session
from app.deps import get_current_user
from app.models import ScoreCard, User, utc_now
from app.schemas import ScoreCardCreate, ScoreCardRead, ScoreCardUpdate

router = APIRouter(prefix="/api/scores", tags=["scores"])


def get_card_for_user(session: Session, card_id: int, user_id: int) -> ScoreCard:
    card = session.get(ScoreCard, card_id)
    if card is None or card.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="成绩卡不存在")
    return card


def calc_gpa(subjects: list[dict]) -> tuple[float, float]:
    """返回 (加权总分, GPA)"""
    if not subjects:
        return 0, 0
    total_weighted = 0.0
    total_credits = 0.0
    for s in subjects:
        credit = float(s.get("credit", 1))
        score = float(s.get("score", 0))
        total_weighted += score * credit
        total_credits += credit
    avg = total_weighted / total_credits if total_credits > 0 else 0
    # 简单 GPA 换算：100分制 → 4.0 制
    gpa = round(avg / 100 * 4.0, 2) if avg > 0 else 0
    return round(avg, 1), gpa


def normalize_score_items(payload: ScoreCardCreate | ScoreCardUpdate, *, existing_json: str | None = None) -> list[dict]:
    if payload.modules is not None:
        return [item.model_dump() for item in payload.modules]
    if payload.subjects is not None:
        return [item.model_dump() for item in payload.subjects]
    if existing_json:
        return json.loads(existing_json)
    return []


def calc_total(items: list[dict]) -> tuple[float, float]:
    module_names = {item.get("name") for item in items}
    if "合计" in module_names:
        total = next((float(item.get("score") or 0) for item in items if item.get("name") == "合计"), 0.0)
        return round(total, 2), 0
    if any(str(item.get("name", "")).startswith(("10%", "65%", "20%", "5%")) for item in items):
        weights = {
            "10%基本素质": 0.10,
            "65%智育+体育": 0.65,
            "20%创新素质与实践能力": 0.20,
            "5%附件分": 0.05,
        }
        total = sum(float(item.get("score") or 0) * weights.get(str(item.get("name")), 0) for item in items)
        return round(total, 2), 0
    return calc_gpa(items)


def card_response(card: ScoreCard) -> dict:
    data = card.model_dump()
    data["modules_json"] = card.subjects_json
    return data


@router.get("", response_model=list[ScoreCardRead])
def list_score_cards(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    cards = list(
        session.exec(
            select(ScoreCard)
            .where(ScoreCard.user_id == current_user.id)
            .order_by(ScoreCard.created_at.desc())
        ).all()
    )
    return [card_response(card) for card in cards]


@router.post("", response_model=ScoreCardRead)
def create_score_card(
    payload: ScoreCardCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    items = normalize_score_items(payload)
    if not items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请至少填写一项成绩")
    total, gpa = calc_total(items)
    now = utc_now()
    card = ScoreCard(
        user_id=current_user.id,
        title=payload.title.strip(),
        semester=payload.semester,
        subjects_json=json.dumps(items, ensure_ascii=False),
        total_score=total,
        gpa=gpa,
        note=payload.note,
        created_at=now,
        updated_at=now,
    )
    session.add(card)
    session.flush()
    add_audit_log(
        session, request=request, action="score_card.create",
        user_id=current_user.id, detail={"card_id": card.id, "title": card.title},
    )
    session.commit()
    session.refresh(card)
    return card_response(card)


@router.put("/{card_id}", response_model=ScoreCardRead)
def update_score_card(
    card_id: int,
    payload: ScoreCardUpdate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    card = get_card_for_user(session, card_id, current_user.id)
    if payload.title is not None:
        card.title = payload.title.strip()
    if payload.semester is not None:
        card.semester = payload.semester
    if payload.subjects is not None or payload.modules is not None:
        items = normalize_score_items(payload)
        card.subjects_json = json.dumps(items, ensure_ascii=False)
        total, gpa = calc_total(items)
        card.total_score = total
        card.gpa = gpa
    if payload.note is not None:
        card.note = payload.note
    card.updated_at = utc_now()
    session.add(card)
    add_audit_log(
        session, request=request, action="score_card.update",
        user_id=current_user.id, detail={"card_id": card.id},
    )
    session.commit()
    session.refresh(card)
    return card_response(card)


@router.delete("/{card_id}")
def delete_score_card(
    card_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    card = get_card_for_user(session, card_id, current_user.id)
    session.delete(card)
    add_audit_log(
        session, request=request, action="score_card.delete",
        user_id=current_user.id, detail={"card_id": card_id},
    )
    session.commit()
    return {"ok": True}


@router.post("/{card_id}/analyze", response_model=ScoreCardRead)
def analyze_score_card(
    card_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    card = get_card_for_user(session, card_id, current_user.id)
    settings = get_settings()
    config = require_config(ai_config(settings), message="请先配置 AI/OCR Key")

    subjects = json.loads(card.subjects_json)
    subject_lines = "\n".join(
        f"- {s['name']}：{s['score']}分（学分 {s.get('credit', 1)}）" for s in subjects
    )

    prompt = f"""你是学习分析助手。请根据以下综测成绩，做简短分析并给出学习计划建议。

成绩卡：{card.title}
学期：{card.semester or '未知'}
加权均分：{card.total_score}，GPA：{card.gpa}

各科成绩：
{subject_lines}

请从以下几个方面分析（每条一句话，不要长篇）：
1. 优势科目
2. 薄弱科目
3. 改进建议
4. 下学期学习计划要点

直接回复中文，每条一句话即可。"""

    ai_text = call_chat_completion(
        config,
        [
            {"role": "system", "content": "你是学习分析助手。回复简洁，每条一句话。"},
            {"role": "user", "content": prompt},
        ],
        temperature=0.5,
        max_tokens=500,
        timeout=30.0,
        failure_message="AI 分析失败，请检查配置后重试",
    )

    card.ai_analysis = ai_text
    card.updated_at = utc_now()
    session.add(card)
    session.commit()
    session.refresh(card)
    return card_response(card)

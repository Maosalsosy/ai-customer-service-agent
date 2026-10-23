import logging
import os

from .deepseek import generate_with_deepseek, resolve_deepseek
from .schemas import Citation, KnowledgeHit, ReplyDraftRequest, ReplyDraftResponse

logger = logging.getLogger(__name__)


# 与 Nest `reply-policy.ts` 对齐；业务权威在 Nest，此处作纵深防御。
SENSITIVE_KEYWORDS = (
    "退款",
    "赔偿",
    "改价",
    "取消订单",
    "律师",
    "投诉",
    "违约金",
    "合同条款",
    "框架协议",
    "色差赔偿",
    "月结",
)

# 寒暄/致谢：无知识命中时也允许短回复，避免一律「商务核实」。
_CHITCHAT_EXACT = {
    "你好",
    "您好",
    "在吗",
    "在嘛",
    "嗨",
    "hi",
    "hello",
    "早上好",
    "下午好",
    "晚上好",
    "谢谢",
    "谢谢你",
    "谢谢您",
    "感谢",
    "多谢",
    "好的",
    "好的谢谢",
    "收到",
    "嗯",
    "ok",
    "OK",
}


def _is_chitchat(text: str) -> bool:
    normalized = text.strip().lower().rstrip("！!。.?？~～")
    if not normalized:
        return False
    if normalized in {item.lower() for item in _CHITCHAT_EXACT}:
        return True
    if len(normalized) <= 8 and any(
        normalized.startswith(p) for p in ("你好", "您好", "谢谢", "感谢", "好的")
    ):
        return True
    return False


def generate_reply_draft(req: ReplyDraftRequest) -> ReplyDraftResponse:
    text = req.customerMessage.strip()
    if not text:
        return ReplyDraftResponse(
            status="failed",
            draft=None,
            reason="empty_customer_message",
            risk_flags=["empty_input"],
        )

    sensitive = [k for k in SENSITIVE_KEYWORDS if k in text]
    if sensitive:
        return ReplyDraftResponse(
            status="needs_human",
            draft="这个问题涉及敏感业务处理，建议由人工客服核实后回复。",
            reason="policy_sensitive_business_action",
            risk_flags=sensitive,
            citations=_citations(req.knowledgeHits),
        )

    if not req.knowledgeHits:
        if _is_chitchat(text):
            draft = (
                "您好，我是客服助手，请问有什么可以帮您？"
                if any(text.startswith(p) for p in ("你好", "您好", "在吗", "在嘛", "嗨", "hi", "Hello", "hello"))
                else "好的，有需要随时告诉我。"
            )
            return ReplyDraftResponse(
                status="draft_ready",
                draft=draft,
                reason="chitchat_no_knowledge",
                risk_flags=[],
                citations=[],
            )
        return ReplyDraftResponse(
            status="needs_human",
            draft="这项具体要求我还需要和商务同事核实，确认后尽快回复您。",
            reason="knowledge_not_found",
            risk_flags=["knowledge_not_found"],
            citations=[],
        )

    if resolve_deepseek(req):
        try:
            return generate_with_deepseek(req)
        except Exception:
            logger.exception("DeepSeek reply generation failed")

    if os.getenv("NODE_ENV") == "production":
        return ReplyDraftResponse(
            status="needs_human",
            draft="AI 服务暂时不可用，请由人工客服核实后回复。",
            reason="model_unavailable",
            risk_flags=["model_unavailable"],
            citations=_citations(req.knowledgeHits),
        )

    if not req.knowledgeHits:
        return ReplyDraftResponse(
            status="needs_human",
            draft="大模型暂不可用，无法回答知识库以外的问题。",
            reason="model_unavailable",
            risk_flags=["model_unavailable"],
        )

    hit = req.knowledgeHits[0]
    draft = hit.excerpt.strip() or hit.title.strip()
    max_len = req.policy.maxLength
    if len(draft) > max_len:
        draft = draft[: max_len - 1] + "…"

    return ReplyDraftResponse(
        status="draft_ready",
        draft=draft,
        citations=_citations(req.knowledgeHits),
        reason=None,
        risk_flags=[],
    )


def _citations(hits: list[KnowledgeHit]) -> list[Citation]:
    return [
        Citation(documentId=h.documentId, quote=h.excerpt)
        for h in hits[:3]
    ]

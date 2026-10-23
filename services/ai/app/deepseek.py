import json
import os

import httpx

from .schemas import Citation, KnowledgeHit, ModelMeta, ReplyDraftRequest, ReplyDraftResponse

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-chat"


def deepseek_configured() -> bool:
    return bool(os.getenv("DEEPSEEK_API_KEY", "").strip())


def resolve_deepseek(req: ReplyDraftRequest) -> tuple[str, str, str] | None:
    override = req.provider
    api_key = (override.apiKey if override and override.apiKey else "") or os.getenv(
        "DEEPSEEK_API_KEY", ""
    )
    api_key = api_key.strip()
    if not api_key:
        return None
    base = (
        (override.baseUrl if override and override.baseUrl else "")
        or os.getenv("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL)
    ).rstrip("/")
    model = (
        (override.model if override and override.model else "")
        or os.getenv("DEEPSEEK_MODEL", DEFAULT_MODEL)
    ).strip() or DEFAULT_MODEL
    return api_key, base, model


def deepseek_model_name() -> str:
    return os.getenv("DEEPSEEK_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL


def test_provider(api_key: str, base_url: str | None = None, model: str | None = None) -> dict:
    key = api_key.strip()
    if not key:
        return {"ok": False, "message": "尚未填写 API Key"}
    base = (base_url or os.getenv("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL)).rstrip("/")
    if not base:
        return {"ok": False, "message": "尚未填写接口地址"}
    chosen = (model or "").strip() or DEFAULT_MODEL
    headers = {"Authorization": f"Bearer {key}"}
    try:
        with httpx.Client(timeout=20.0) as client:
            listed = client.get(f"{base}/models", headers=headers)
            if listed.status_code == 401:
                return {"ok": False, "message": "API Key 无效"}
            listed_hint = ""
            if listed.status_code == 200:
                try:
                    payload = listed.json()
                    rows = payload.get("data") if isinstance(payload, dict) else None
                    model_ids = {
                        str(row.get("id")).strip()
                        for row in (rows or [])
                        if isinstance(row, dict) and row.get("id")
                    }
                except Exception:
                    model_ids = set()
                if model_ids and chosen not in model_ids:
                    listed_hint = "（该地址的模型列表未包含此名称，已按你填写的模型实测）"
            chat = client.post(
                f"{base}/chat/completions",
                headers={**headers, "Content-Type": "application/json"},
                json={
                    "model": chosen,
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "ping"}],
                },
            )
    except httpx.HTTPError:
        return {"ok": False, "message": "无法连接模型接口，请检查接口地址"}
    if chat.status_code == 401:
        return {"ok": False, "message": "API Key 无效"}
    if chat.status_code == 404:
        return {
            "ok": False,
            "message": "接口地址可能不正确（未找到 /chat/completions），常见需带 /v1",
        }
    if chat.status_code >= 400:
        detail = ""
        try:
            body = chat.json()
            err = body.get("error") if isinstance(body, dict) else None
            if isinstance(err, dict):
                detail = str(err.get("message") or err.get("code") or "")
            elif isinstance(err, str):
                detail = err
        except Exception:
            detail = ""
        suffix = f"：{detail}" if detail else ""
        return {
            "ok": False,
            "message": f"模型「{chosen}」调用失败（{chat.status_code}）{suffix}",
        }
    extra = f" {listed_hint}" if listed_hint else ""
    return {"ok": True, "message": f"密钥、接口地址与模型「{chosen}」均可用{extra}"}


def generate_with_deepseek(req: ReplyDraftRequest) -> ReplyDraftResponse:
    resolved = resolve_deepseek(req)
    if not resolved:
        raise RuntimeError("DeepSeek API key is not set")
    api_key, base, model = resolved
    hits = req.knowledgeHits[:5]
    knowledge_block = "\n".join(
        f"- id={hit.documentId} title={hit.title} excerpt={hit.excerpt}"
        for hit in hits
    )
    history = "\n".join(
        f"{turn.role}: {turn.content}" for turn in req.conversationContext[-6:]
    )

    if hits and req.policy.requireCitations:
        grounding = (
            "已提供知识片段时，只根据这些片段回答，不要编造片段里没有的价格、交期、政策或承诺。"
            "信息不足时可简短追问一个关键信息（如数量、用途），不要连续追问。"
            "draft_ready 时 citationDocumentIds 至少包含一个知识片段 id，且只能使用片段里出现过的 id。"
        )
    else:
        grounding = (
            "没有知识片段时：若客户最新消息是寒暄、致谢或与业务无关的闲聊，可用一句简短礼貌回复，status 为 draft_ready，citationDocumentIds 为空。"
            "若是具体业务问题，明确表示需要人工核实，status 必须为 needs_human，citationDocumentIds 必须为空。"
            "不要编造该企业的价格、交期、合同或内部政策，也不要假装引用了内部文档。"
        )
    tone = (req.policy.tone or "direct").strip().lower()
    if tone == "warm":
        tone_line = "语气亲切温和，可适当礼貌用语，但仍保持简洁。"
    elif tone == "formal":
        tone_line = "语气正式庄重，用书面语，避免口语化。"
    else:
        tone_line = "语气直接简洁，少客套，先给结论。"
    persona = (req.policy.persona or "").strip()
    role_line = f"你是{persona}。" if persona else "你是企业客服。"
    extra = (req.policy.systemPrompt or "").strip()
    extra_line = f"补充指令：{extra}" if extra else ""
    system = (
        f"{role_line}"
        "回答自然、专业，不要套话连篇。"
        f"{tone_line}"
        "可以一句简短回应寒暄或致谢；回答业务问题时直接给结论，必要时再补一句说明。"
        "信息不足时允许追问一个关键澄清问题；不要主动推销或编造未提供的承诺。"
        "是否转人工只看客户最新一条消息是否涉及退款、赔偿、改价或投诉，不要因为更早的历史转人工。"
        f"{grounding}"
        f"{extra_line}"
        "只返回 JSON："
        '{"status":"draft_ready|needs_human","draft":"回复正文","citationDocumentIds":["id"],"reason":"可选原因"}'
    )
    user = (
        f"语气要求：{tone_line}\n"
        f"长度上限：{req.policy.maxLength} 字\n"
        f"近期对话：\n{history or '（无）'}\n"
        f"客户最新消息：{req.customerMessage}\n"
        f"知识片段：\n{knowledge_block or '（无）'}"
    )

    with httpx.Client(timeout=30.0) as client:
        response = client.post(
            f"{base}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
        )
        response.raise_for_status()
        payload = response.json()

    content = payload["choices"][0]["message"]["content"]
    parsed = json.loads(content)
    status = parsed.get("status")
    if status not in ("draft_ready", "needs_human"):
        status = "needs_human"
    draft = parsed.get("draft")
    if isinstance(draft, str):
        draft = draft.strip()[: req.policy.maxLength] or None
    else:
        draft = None

    allowed = {hit.documentId: hit for hit in hits}
    citations: list[Citation] = []
    for doc_id in parsed.get("citationDocumentIds") or []:
        hit = allowed.get(str(doc_id))
        if hit:
            citations.append(Citation(documentId=hit.documentId, quote=hit.excerpt))

    return ReplyDraftResponse(
        status=status,
        draft=draft,
        citations=citations,
        reason=parsed.get("reason"),
        model=ModelMeta(
            provider=(req.provider.name if req.provider and req.provider.name else "openai-compatible"),
            name=model,
        ),
    )


def provider_status() -> dict:
    return {
        "provider": "deepseek",
        "model": deepseek_model_name(),
        "baseUrl": os.getenv("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL),
        "configured": deepseek_configured(),
    }

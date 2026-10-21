import os

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from .deepseek import provider_status, test_provider
from .reply import generate_reply_draft
from .schemas import ReplyDraftRequest, ReplyDraftResponse

app = FastAPI(
    title="AI客服 AI Service",
    version="0.1.0",
    description="面向 NestJS 的内部回复草稿服务。配置 DEEPSEEK_API_KEY 后调用 DeepSeek。",
)

def verify_service_token(
    authorization: str | None = Header(default=None),
    x_ai_token: str | None = Header(default=None),
) -> None:
    expected = os.getenv("AI_SERVICE_TOKEN", "dev-ai-token")
    token = x_ai_token
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if token != expected:
        raise HTTPException(status_code=401, detail="Invalid AI service token")


@app.get("/health")
def health() -> dict:
    status = provider_status()
    return {
        "ok": True,
        "service": "aikefu-ai",
        "provider": status["provider"],
        "model": status["model"],
        "configured": status["configured"],
    }


@app.post(
    "/internal/v1/reply-drafts",
    response_model=ReplyDraftResponse,
    dependencies=[Depends(verify_service_token)],
)
def create_reply_draft(body: ReplyDraftRequest) -> ReplyDraftResponse:
    return generate_reply_draft(body)


class ProviderTestBody(BaseModel):
    apiKey: str
    baseUrl: str | None = None
    model: str | None = None


@app.post(
    "/internal/v1/provider/test",
    dependencies=[Depends(verify_service_token)],
)
def test_provider_route(body: ProviderTestBody) -> dict:
    return test_provider(body.apiKey, body.baseUrl, body.model)

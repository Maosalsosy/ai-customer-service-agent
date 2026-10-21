from typing import Literal

from pydantic import BaseModel, Field


class ConversationTurn(BaseModel):
    role: Literal["customer", "agent", "system"] = "customer"
    content: str


class ReplyPolicy(BaseModel):
    tone: str = "direct"
    maxLength: int = Field(default=500, ge=50, le=2000)
    requireCitations: bool = False


class Citation(BaseModel):
    documentId: str
    chunkId: str | None = None
    quote: str


class KnowledgeHit(BaseModel):
    documentId: str
    title: str
    excerpt: str


class ProviderCredentials(BaseModel):
    apiKey: str | None = None
    baseUrl: str | None = None
    model: str | None = None
    name: str | None = None


class ReplyDraftRequest(BaseModel):
    tenantId: str
    conversationId: str
    messageId: str | None = None
    customerMessage: str
    conversationContext: list[ConversationTurn] = Field(default_factory=list)
    knowledgeHits: list[KnowledgeHit] = Field(default_factory=list)
    policy: ReplyPolicy = Field(default_factory=ReplyPolicy)
    provider: ProviderCredentials | None = None


class ModelMeta(BaseModel):
    provider: str = "local-rule"
    name: str = "heuristic-v1"


class ReplyDraftResponse(BaseModel):
    status: Literal["draft_ready", "needs_human", "failed"]
    draft: str | None
    citations: list[Citation] = Field(default_factory=list)
    reason: str | None = None
    risk_flags: list[str] = Field(default_factory=list)
    model: ModelMeta = Field(default_factory=ModelMeta)

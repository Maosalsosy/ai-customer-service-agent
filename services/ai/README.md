# AI 内部服务

FastAPI 服务为业务 API 提供回复草稿生成和模型连通性检查。它不是面向浏览器或公网用户的独立业务 API。

## 1. 本地开发

前置要求：Python 3.12。Windows PowerShell：

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:AI_SERVICE_TOKEN="dev-ai-token"
uvicorn app.main:app --reload --port 8000
```

macOS/Linux 激活命令为 `source .venv/bin/activate`，设置令牌使用 `export AI_SERVICE_TOKEN=dev-ai-token`。

健康检查：<http://localhost:8000/health>。

## 2. 内部接口

所有内部请求都需要服务令牌，可通过 `X-AI-Token` 或 Bearer Authorization 传递。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 健康状态和模型配置状态 |
| `POST` | `/internal/v1/reply-drafts` | 生成回复草稿 |
| `POST` | `/internal/v1/provider/test` | 检查模型接口连通性 |

回复请求包含客户消息，可附带业务 API 检索出的知识片段。请求和响应 schema 见 `app/schemas.py`；调用入口见 `app/main.py`。

## 3. 模型配置

业务侧模型配置保存在 API 中，并从 AI 模型设置页面管理。AI 服务也支持环境变量 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` 作为默认 DeepSeek 上游配置。未配置可用模型或上游调用失败时，AI 服务会按当前实现回退本地规则；因此健康检查成功不代表外部模型凭证有效。

API 与 AI 服务的 `AI_SERVICE_TOKEN` 必须完全一致。生产环境须设置唯一随机令牌，不能沿用文档中的开发值。模型回复和模拟发送不构成真实企业微信投递验收。

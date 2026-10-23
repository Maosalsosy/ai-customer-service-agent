# 业务 API

NestJS / TypeScript 模块化单体，负责身份认证、工作区授权、会话、知识库、AI 配置、审计和企业微信适配。面向单一企业工作区部署。默认监听端口 `3001`。

## 1. 本地开发

前置要求：Node.js 22+。在本目录执行：

```powershell
npm install
npm run start:dev
```

API 统一使用 PostgreSQL + Prisma + pgvector。启动前需启动 PostgreSQL、配置 `DATABASE_URL` 并应用迁移；也可以使用根目录 Docker Compose 启动包含数据库的演示环境。需要单独覆盖配置时，可将 `.env.example` 复制为 `.env` 后编辑；若 `.env` 已存在，请先保留现有配置。

存活检查：<http://localhost:3001/health>。就绪检查：<http://localhost:3001/ready>，数据库不可用或生产 Redis 不可用时返回 HTTP 503，并包含 AI 服务状态；模拟与真实企业微信能力边界见[项目演示手册](../../docs/13-project-status-and-demo-guide.md)。

## 2. 数据存储

| 模式 | 设置 | 用途 |
| --- | --- | --- |
| PostgreSQL + pgvector | `DATABASE_URL` | 本地开发、Docker Compose 演示和生产统一使用；知识向量由 PostgreSQL 召回 |

常用 Prisma 命令：

```powershell
npm run prisma:generate
npm run prisma:migrate
npm run prisma:deploy
```

`prisma:migrate` 用于本地开发时创建迁移；`prisma:deploy` 应用于已提交迁移的部署环境。Compose 启动 API 容器前会执行 `prisma migrate deploy`。

## 3. 内部服务和安全配置

- `AI_SERVICE_URL` 指向 FastAPI 服务；`AI_SERVICE_TOKEN` 必须与 AI 服务一致。
- `AUTH_SECRET` 用于 JWT 签名。生产环境必须替换开发值。
- `AI_KEY_SECRET` 用于加密保存模型 API Key 和微信客服应用凭证，留空会回退至 `AUTH_SECRET`；生产必须配置稳定密钥。
- `REDIS_URL` 用于跨实例实时事件和共享限流；微信客服真实发送依赖 Redis 对同一客户的回复额度做互斥，Redis 不可用时真实发送失败关闭。
- 生产首次启动空数据库时可设置 `BOOTSTRAP_ADMIN_EMAIL`、`BOOTSTRAP_ADMIN_PASSWORD` 和 `BOOTSTRAP_TENANT_NAME` 创建首个管理员。创建成功后移除引导密码。

变量清单和生产启动限制见 `.env.example` 与[安全、测试与部署](../../docs/08-security-testing-deployment.md)。不要将真实凭证提交到版本库。

## 4. 常用命令

```powershell
npm run start:dev
npm run build
npm run lint
npm run test
npm run test:e2e
```

当前 API 设计说明见[API 规范](../../docs/05-api-specification.md)；该文档仍标记为设计草案，接口行为以控制器和服务实现为准。

# Web 前端

基于 Next.js App Router、React、TypeScript 和 Tailwind CSS 的管理端、客服工作台与客户演示门户。

## 1. 本地开发

前置要求：Node.js 22+，并启动业务 API（默认 `http://localhost:3001`）。

```powershell
npm install
npm run dev
```

打开 <http://localhost:3000>。如需覆盖 API 地址，可在本目录创建 `.env.local`：

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
NEXT_PUBLIC_WECOM_CALLBACK_BASE=https://api.example.com
```

真实微信客服接入时，`NEXT_PUBLIC_WECOM_CALLBACK_BASE` 应配置为企业微信服务器可访问的公网 HTTPS API 基址；留空时使用 `NEXT_PUBLIC_API_BASE_URL`。

变量模板见 `.env.example`。使用 Docker Compose 时，Web 地址和端口通过根目录 `.env` 中的 `WEB_BIND`、`WEB_PORT` 控制。

## 2. 页面入口

| 路径 | 用途 |
| --- | --- |
| `/login` | 登录 |
| `/inbox` | 客服工作台 |
| `/dashboard` | 业务概览 |
| `/customers` | 会话级客户策略管理 |
| `/knowledge` | 知识库与知识空间 |
| `/settings/ai` | AI 模型与自动发送配置（管理员） |
| `/settings/members` | 成员与角色管理（管理员） |
| `/settings/audit` | 操作记录（管理员） |
| `/customer` | 客户演示门户 |

## 3. 常用命令

```powershell
npm run dev
npm run build
npm run start
npm run lint
```

`npm run build` 会执行 Next.js 生产构建和 TypeScript 检查。前端页面不直接访问数据库，业务数据通过 API 获取。演示账号和全流程步骤见根目录 [README](../../README.md) 与[演示手册](../../docs/13-project-status-and-demo-guide.md)。

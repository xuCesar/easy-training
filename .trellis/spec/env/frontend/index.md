# Web 环境变量规范

- 先加载 [项目级工程约束](../../guides/project-conventions.md)。
- 客户端变量统一在 `packages/env/src/web.ts` 校验，必须使用 `VITE_` 前缀并可安全公开。
- 当前 `VITE_SERVER_URL` 可以是绝对 URL 或部署时使用的相对 RPC 来源；URL 归一化继续复用 `apps/web/src/utils/orpc.ts`。
- 密钥、数据库连接、内部服务凭据和仅服务端使用的开关不得加入客户端 schema。

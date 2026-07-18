# Server 后端规范

- 先加载 [项目级工程约束](../../guides/project-conventions.md)。
- `apps/server/src/index.ts` 是 Hono 装配入口：负责 CORS、请求体限制、可信 Origin、Better Auth handler、oRPC/OpenAPI handler 和启动端口。
- 业务契约、权限和数据访问分别留在 `packages/api` 与 `packages/db`；不要在 Hono 入口新增业务 repository 或复制 router 逻辑。
- 带 Cookie 的写请求必须继续校验 `Origin === env.CORS_ORIGIN`；新增入口时保持请求体限制和凭据 CORS 语义。
- 服务端错误日志不得包含 Cookie、Token、密码、数据库连接串或完整隐私请求体。

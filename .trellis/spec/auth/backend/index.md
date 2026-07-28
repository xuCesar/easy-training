# Auth 后端规范

- 先加载 [项目级工程约束](../../guides/project-conventions.md)。
- Better Auth 配置集中在 `packages/auth/src/index.ts`，数据库 schema 使用 `packages/db/src/schema/auth.ts`。
- 认证密钥和 URL 只能从 `@easy-training/env/server` 读取；不得暴露到 Web 环境变量或日志。
- Cookie 保持 `httpOnly`；生产环境保持 `secure: true`、`sameSite: "none"`，开发环境使用 `lax`。
- `trustedOrigins` 与服务端 CORS 来源保持一致。修改 session、Cookie、Origin 或登录方式时必须同时评估 CSRF、跨域和现有会话兼容性。
- 生产环境的 Better Auth IP 跟踪只读取 `x-real-ip`；nginx 必须继续使用
  `$remote_addr` 覆盖该请求头。不要改为信任客户端可注入的多段 `x-forwarded-for`，
  否则登录限流可能被绕过或退化为共享桶。
- 资源授权必须继续由 API 服务端过程执行，不能仅凭“存在 session”放行领域数据。

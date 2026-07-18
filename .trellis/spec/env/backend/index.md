# 服务端环境变量规范

- 先加载 [项目级工程约束](../../guides/project-conventions.md)。
- 所有服务端变量在 `packages/env/src/server.ts` 使用 Zod 显式校验，再通过 `@easy-training/env/server` 使用。
- `DATABASE_URL`、`BETTER_AUTH_SECRET` 等敏感变量绝不能进入 `web.ts`、`VITE_*`、客户端 bundle 或日志。
- 新增变量时同步更新相应 `.env.example`，只写占位值和必要说明。
- 不通过放宽校验或长期设置 `SKIP_ENV_VALIDATION` 解决部署配置错误。

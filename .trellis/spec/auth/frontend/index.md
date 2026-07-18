# Auth 前端消费边界

- 先加载 [项目级工程约束](../../guides/project-conventions.md)。
- `packages/auth` 是服务端 Better Auth 配置，不得被浏览器 bundle 直接导入。
- Web 认证交互通过 `apps/web/src/lib/auth-client.ts` 和现有登录组件完成；服务端安全约束以 [Auth 后端规范](../backend/index.md) 为准。

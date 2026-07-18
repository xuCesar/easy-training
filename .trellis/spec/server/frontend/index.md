# Server 前端边界

- 先加载 [项目级工程约束](../../guides/project-conventions.md)。
- `apps/server` 不包含前端代码。浏览器只通过 Better Auth 与 oRPC/OpenAPI HTTP 入口交互。
- Web 行为以 [Web 前端规范](../../web/frontend/index.md) 为准，HTTP 装配以 [Server 后端规范](../backend/index.md) 为准。

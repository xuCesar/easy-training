# API 前端消费边界

- 先加载 [项目级工程约束](../../guides/project-conventions.md)。
- `packages/api` 不承载 React 组件或客户端状态；前端只消费其导出的契约和 `AppRouterClient` 类型。
- 前端调用规范以 [Web 前端规范](../../web/frontend/index.md) 为准，契约与授权规范以 [API 后端规范](../backend/index.md) 为准。

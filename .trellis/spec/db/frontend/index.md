# Database 前端边界

- 先加载 [项目级工程约束](../../guides/project-conventions.md)。
- `packages/db` 是纯服务端包，Web 不得直接导入数据库实例、schema 或 repository。
- 前端只能通过 oRPC 契约访问数据；数据库实现与安全规则以 [Database 后端规范](../backend/index.md) 为准。

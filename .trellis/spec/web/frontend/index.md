# Web 前端规范

- 先加载 [项目级工程约束](../../guides/project-conventions.md)。
- 路由放在 `apps/web/src/routes`，教培业务 UI 放在 `apps/web/src/features/training`，跨应用基础组件复用 `packages/ui`。
- 服务端状态使用 `apps/web/src/utils/orpc.ts` 暴露的 oRPC + TanStack Query 工具；请求必须保留 `credentials: "include"` 和统一 QueryCache 错误反馈。
- 当前机构请求头只能表达前端期望值，不能替代服务端成员关系校验。
- 金额展示复用 `formatCentsToCurrency`；日期时间展示按 `Asia/Shanghai`，不要在组件中散落新的格式化实现。
- 优先派生状态，不重复存储；表单和异步交互明确处理加载、错误、空状态与提交中状态。
- 带 `requestId` 的 mutation 按一次编辑或确认会话生成 ID：同一载荷失败重试必须复用，成功或放弃会话后再轮换；提交中必须阻止对话框关闭和会话组件卸载。
- 运营任务列表、筛选、派单表单和提醒入口加载 [运营任务与提醒契约](../../db/backend/operation-tasks.md)。

# API 后端规范

- 先加载 [项目级工程约束](../../guides/project-conventions.md)。
- `contracts/` 定义 Zod 输入/输出与共享类型，`routers/` 负责 oRPC 过程编排，`repositories/` 负责持久化适配；不要把 SQL 或复杂业务规则堆进 router handler。
- 受保护过程必须复用 `protectedProcedure`、`organizationProcedure` 或领域过程；新增角色能力时同步检查 `authorization/training.ts`。
- router 向 repository 显式传入服务端解析的 `organizationId`、`userId` 和必要角色，不从业务 input 接受租户边界。
- 修改契约时同步检查 `AppRouterClient`、Web query/mutation、OpenAPI 输出和相关集成测试。
- 参数错误、未认证、无权限、资源不存在、业务冲突和系统错误保持不同语义，不向客户端泄露内部错误。
- 涉及 oRPC body limit、上传或大文本输入时，加载 [RPC 请求大小契约](request-size-contracts.md)，按实际 transport envelope 的 UTF-8 字节而不是文件大小或字符数校验。

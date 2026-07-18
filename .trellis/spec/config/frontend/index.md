# 共享配置规范

- 先加载 [项目级工程约束](../../guides/project-conventions.md)。
- `packages/config` 只承载跨 workspace 的 TypeScript 基础配置，不放业务逻辑、运行时环境变量或应用专属构建选项。
- 修改共享配置前检查所有 apps/packages 的继承关系，并运行全仓 `pnpm check-types` 与必要构建。
- 不为单个 workspace 的临时问题放宽全仓类型安全规则。

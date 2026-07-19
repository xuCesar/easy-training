# Repository 调研：可观测性与交付

调研日期：2026-07-19；仅记录已验证的代码库事实。

## 仓库内可完成的 P0 闭环

- Hono server 生成或校验 `X-Request-Id`，响应回显，输出不含敏感请求体的 JSON 结构化访问/异常事件。
- 新增 `/readyz` 执行数据库 `SELECT 1`，保留 `/` 作为 liveness，区分进程存活和可服务。
- 添加 GitHub CI：冻结安装、迁移、类型、Biome、集成测试、构建；CI 使用 `pnpm --filter @easy-training/db db:migrate`，不使用 `db:push`。
- README 记录生产迁移、迁移失败停止发布、备份、隔离恢复验证与应用回滚步骤。

## 已知边界

- 当前只有 Hono 文本 logger 和未结构化的 `console.error`；根目录没有 `.github/workflows`。
- `db:migrate` 在 Turbo 配置中是 persistent，不适合作为 CI 的 Turbo 任务，应直接调用 package script。
- 日志/告警平台、生产备份存储、RPO/RTO、隔离恢复环境、部署凭据及分支保护规则未提供；任务只能交付接入契约和 runbook，不能声称外部告警或灾备演练已完成。

## 验证切入点

- `apps/server/src/app.test.ts`：request ID 生成/回显、非法值拒绝、`/readyz` 200/503、异常日志不含敏感输入。
- CI 静态审查：不使用 `db:push`，工作流顺序包含 migration、check-types、check、test:integration、build。

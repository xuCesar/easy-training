# P0 可观测性与交付保障：技术设计

## 边界与职责

- `apps/server/src/app.ts`：在最外层 Hono middleware 建立请求上下文，统一写入 JSON 行日志并回显 `X-Request-Id`；`/readyz` 只执行最小数据库连通性查询。
- `apps/server/src/app.test.ts`：使用可注入的依赖或测试替身覆盖请求 ID、日志脱敏和 readiness 成功/失败。
- `.github/workflows/ci.yml`：仅编排仓库现有脚本与 PostgreSQL service，不承载部署逻辑。
- `README.md`：记录生产操作步骤与外部前置条件，不保存环境机密。

## 请求与日志契约

- 请求 ID 使用入站 `X-Request-Id`（仅允许受限长度的可打印标识）；缺失或非法时由服务端生成 UUID。
- 所有响应均回显最终 `X-Request-Id`。
- 访问日志使用单行 JSON，至少包含 `event`、`requestId`、`method`、`path`、`status`、`durationMs`。
- 未预期异常日志使用单行 JSON，包含 `event`、`requestId` 与安全的错误描述；不写入 request body、Authorization、Cookie 或 token。

## Readiness

- `/` 保持无依赖 liveness（200 `OK`）。
- `/readyz` 通过现有数据库连接执行 `SELECT 1`；成功 200，连接/查询异常 503，不返回内部错误。

## CI 与运行手册

- CI 的工作目录保持根目录，使用 `pnpm install --frozen-lockfile`、`pnpm --filter @easy-training/db db:migrate`、`pnpm check-types`、`pnpm check`、`pnpm test:integration`、`pnpm build`。
- PostgreSQL service 的数据库名、用户名和密码仅为 CI 临时值，使用 `DATABASE_URL` 传递给命令。
- README 将本地开发 `db:push` 与生产受版本控制的 `db:migrate` 分开；恢复必须先在隔离环境验证再切换应用流量，回滚优先应用层兼容回滚，schema 回退需显式迁移与备份确认。

## 兼容与回滚

- 日志与健康检查只新增 HTTP 行为，不改变现有 RPC、认证或 OpenAPI 契约。
- 若 readiness 检查引发运行问题，可移除路由；其余可观测性 middleware 不持久化数据，回滚为恢复原 Hono logger。

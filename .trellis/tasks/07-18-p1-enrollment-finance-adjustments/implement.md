# P1 实施计划：报名与财务变更

1. 扩展 Drizzle schema 并生成审查 migration：报名状态、续费/转课/退款/欠费跟进流水及查询索引。
2. 在财务 repository 实现续费、转课、退款、欠费清单和跟进事务，补齐领域错误与幂等处理。
3. 扩展 Zod contracts、oRPC router 与 API 映射，按当前角色重新授权写入。
4. 在财务工作台实现报名变更、退款明细、欠费跟进的响应式交互和 Query 缓存失效。
5. 扩展 PostgreSQL 集成测试，覆盖金额/课时不变量、租户/校区/角色边界、幂等与并发。
6. 执行 `pnpm db:migrate`、`pnpm check-types`、`pnpm test:integration`、`pnpm check`、`pnpm build`，并通过现有 3000 服务进行桌面/移动端浏览器验收。

## Review Gates

- 不允许通过删除或改写 `payment` / `lessonConsumption` 实现退款或转课。
- 所有财务写入必须在同一事务内重新授权、锁定资源并完成关联投影更新。
- 转课不得在来源存在欠费时继续；退款不得超过实际已收。
- 任何失败均不得留下部分报名、账单、余额或流水。

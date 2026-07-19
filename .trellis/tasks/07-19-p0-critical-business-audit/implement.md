# P0 关键业务审计追溯：实施计划

1. 扩展审计 action enum/schema 并生成、审查 migration；将通用审计 helper 从 operations repository 作为资金和教务仓储可复用的单一写入入口。
2. 在收款、退款、续费、转课和课次结课的既有事务成功路径写入最小白名单快照；修复退款幂等字段比较。
3. 同步 API 审计契约和 Web 筛选/实体中文文案，不改变审计列表响应的快照可见性。
4. 在财务、教务、机构管理集成测试补成功、重放、事务回滚、退款幂等差异和既有成员审计回归。
5. 执行 migration、目标集成测试、`pnpm check-types`、`pnpm check`、`pnpm test:integration`、`pnpm build`；检查 enum migration、校区范围与快照没有泄露敏感字段。

## 风险文件

- `packages/db/src/repositories/finance.ts`、`enrollment-finance-adjustments.ts`、`teaching.ts`：审计必须使用当前 transaction，不能形成事务外副作用。
- `packages/db/src/schema/training.ts`、`packages/db/src/migrations/`：PostgreSQL enum migration 必须与 schema 一致且可在 CI 空库执行。
- `packages/api/src/contracts/training.ts`、`apps/web/src/routes/_auth/audit.tsx`：新 action 必须同源且保持列表筛选类型安全。

## Rollback

若出现未预期业务阻断，回滚应用提交即可停止新审计写入；数据库 enum 值和已写审计记录保留，避免破坏审计可追溯性。

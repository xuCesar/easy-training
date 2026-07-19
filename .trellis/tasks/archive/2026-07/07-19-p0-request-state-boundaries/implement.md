# P0 教务状态边界：实施计划

1. 在 teaching repository 定义集中式班级迁移表和状态/有效报名错误码；创建固定为 `recruiting`，更新在行锁后校验迁移与 `scheduled` 课次。
2. 在入班、容量、成员读取、点名读取和结课事务中统一应用 active 报名条件；转课路径保持清空来源班级归属。
3. 更新 API 错误映射与教务工作台的状态选择，避免界面暴露后端必然拒绝的操作。
4. 在 PostgreSQL 集成测试补：创建/更新状态图、完成前待上课次、转课后重新入班、非 active 报名不出现在名单/不消课，以及现有并发结课回归。
5. 执行目标测试、`pnpm check-types`、`pnpm check`、`pnpm build` 和 `pnpm test:integration`；审查没有扩散到 P1 业务状态。

## 风险文件

- `packages/db/src/repositories/teaching.ts`：查询条件或锁顺序错误可能影响容量、结课和并发一致性。
- `packages/db/src/repositories/enrollment-finance-adjustments.ts`：转课仍必须原子解除旧班级归属。
- `packages/api/src/repositories/teaching.ts` 与 `apps/web/src/features/training/academic-workspace.tsx`：错误映射和可选状态必须与仓储状态机一致。

## 回滚点

- 不含 migration。若状态图阻断了未预见的既有运营流程，可回滚应用代码；不更改历史课次、报名或消课数据。

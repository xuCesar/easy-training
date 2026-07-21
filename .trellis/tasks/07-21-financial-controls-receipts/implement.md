# Issue #29 交付编排计划

## Parent Rule

父任务不执行 `task.py start`，也不直接承载代码提交。每次只启动、实现、检查和归档一个子任务。

## Ordered Delivery

1. 审核并启动 `07-21-refund-approval`。
2. 完成 migration、DB/API/Web、测试、规范更新和提交；归档后再启动 `07-21-payment-reversals`。
3. 冲正归档后启动 `07-21-arrears-workflow`，重点验证所有账单创建/结清/重新欠费路径。
4. 欠费归档后启动 `07-21-receipt-documents`，完成打印和响应式实际验证。
5. 四项均归档后执行父任务最终集成审查，并同步 GitHub Issue #29。

## Cross-task Verification

- 全量运行 `pnpm test:integration`、`pnpm check-types`、`pnpm check` 和 `pnpm build`。
- 用同一账单验证：多笔收款、退款申请/批准、退款后禁止冲正。
- 用另一账单验证：收款结清、部分冲正、欠费新周期、新收款、凭证资金状态。
- 核对 enrollment 累计已收、finance 列表、欠费列表、Dashboard、学员时间线和审计页。
- 桌面与 360–390px 移动端检查所有 Dialog/Sheet/表格/空态/错误态；凭证执行真实打印预览和另存 PDF。

## Final Review Gate

- 四个子 Issue/任务均有独立提交、测试证据和规范更新。
- 父 PRD 的全部验收项有可追踪测试或人工验证记录。
- Issue #29 更新完成范围、验证结果、剩余 out-of-scope 与关联提交；确认无阻断项后再关闭或进入下一 Task。

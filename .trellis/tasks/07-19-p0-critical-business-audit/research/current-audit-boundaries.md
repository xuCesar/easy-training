# P0 #17 现有审计边界调研

- 审计表和共享写入 helper：`packages/db/src/schema/training.ts` 的 `organizationAuditEvent`，`packages/db/src/repositories/operations.ts` 的 `writeOrganizationAuditEvent`。
- 现有组织管理审计已覆盖成员角色、校区范围和移除成员：`packages/db/src/repositories/organization-management.ts`。
- 缺失写入入口：收款 `packages/db/src/repositories/finance.ts`，退款/续费/转课 `packages/db/src/repositories/enrollment-finance-adjustments.ts`，课次结课 `packages/db/src/repositories/teaching.ts`。
- 跨层 action 定义：`packages/api/src/contracts/training.ts`；Web 筛选与文案：`apps/web/src/routes/_auth/audit.tsx`。
- 风险：审计读权限使用 `campusId`，资金与课次事件不能为 null；退款幂等比较遗漏 invoiceId 和 refundedAt。

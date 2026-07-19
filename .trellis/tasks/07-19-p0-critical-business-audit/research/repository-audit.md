# Repository 调研：关键业务审计

调研日期：2026-07-19；仅记录已验证的代码库事实。

## 结论

- `organizationAuditEvent` 是现有统一审计表；组织成员角色、成员校区范围、移除成员和邀请操作已在业务事务内写审计。
- 收款、退款、续费、转课与课次结课均已使用 DB 事务，但尚未写审计。
- 审计 `action` 同时存在 PostgreSQL enum、API schema 与审计页面筛选/文案；新增动作必须同步三处并生成 migration。

## 最小实施范围

| 写入 | DB 入口 | 应补动作 |
| --- | --- | --- |
| 收款 | `createPaymentRecord` | `payment_created` |
| 退款 | `createRefundRecord` | `refund_created` |
| 续费 | `renewEnrollmentRecord` | `enrollment_renewed` |
| 转课 | `transferEnrollmentRecord` | `enrollment_transferred` |
| 课次结课 | `completeLessonRecord` | `lesson_completed` |

- 每一条审计与领域写入同一事务完成；成功仅一条、幂等回放不重复、审计失败整体回滚。
- 资金和课次审计必须写 `campusId`，否则校区管理员无法按现有读取规则看到记录。
- 退款幂等 payload 比对需要补 `invoiceId` 与 `refundedAt`，避免同一 requestId 被错误当作成功回放。

## 依赖与风险

- 班级没有独立“结业”写路径；班级状态完成审计依赖 `p0-request-state-boundaries` 先明确状态图。
- 共享审计 helper 应放在独立 DB 模块，避免 finance/teaching 依赖 `operations.ts` 的无关实现。

## 验证切入点

- `packages/db/tests/finance.integration.ts`：成功、幂等、退款冲突、审计写入失败回滚。
- `packages/db/tests/teaching.integration.ts`：结课成功、重复结课及审计写入失败回滚。
- `packages/db/tests/organization-management.integration.ts`：角色/校区范围变更、移除成员的成功与失败审计。

# P0 关键业务审计追溯：技术设计

## 审计写入边界

`packages/db/src/repositories/operations.ts` 中的 `writeOrganizationAuditEvent` 作为共享写入 helper。资金、报名变更和教务仓储在既有 `db.transaction` 回调中调用它；不从 API 层写入审计，保证任意失败均由事务回滚。

所有事件都写入：`organizationId`、`action`、`entityType`、`entityId`、`actorUserId`、`campusId`、`after`。不使用完整业务对象，`after` 仅包含本任务列出的白名单字段。

| Action | Entity | campusId 来源 | after 白名单 |
| --- | --- | --- | --- |
| `payment_created` | payment | invoice / enrollment 校区 | invoiceId、enrollmentId、amountInCents、method、paidAt、requestId |
| `refund_created` | refund | invoice / enrollment 校区 | invoiceId、enrollmentId、amountInCents、method、refundedAt、requestId |
| `enrollment_renewed` | enrollment renewal | enrollment 学员校区 | enrollmentId、invoiceId、addedLessons、amountInCents、dueDate、requestId |
| `enrollment_transferred` | enrollment transfer | 来源学员校区 | sourceEnrollmentId、targetEnrollmentId、targetCourseId、transferredLessons、requestId |
| `lesson_completed` | lesson | lesson 校区 | classGroupId、activeEnrollmentCount |

## Enum、API 与 UI

新增五个 PostgreSQL enum 值的 Drizzle migration，并同步 schema enum、`auditActionSchema` 与 `AuditEvent` 输出。审计读取仍只返回既有元数据字段，避免把快照扩展为未经设计的对外接口。Web `actions` 与 `entityLabels` 追加中文筛选/展示。

## 幂等与退款修复

写审计位于各 repository 的新业务成功分支；如果 requestId 触发既有记录重放，直接返回而不执行新插入，因此自然不会重复审计。退款重放相等性补上 `invoiceId` 与 `refundedAt`，保持 requestId 对完整业务请求的绑定。

## 测试与回滚

在现有 `finance.integration.ts`、`teaching.integration.ts`、`organization-management.integration.ts` 上扩展集成测试。通过在测试事务/约束中制造审计失败或断言记录数量，验证原子性和重放。迁移只追加 enum 值；应用回滚后新 enum 值保留但不影响既有读写，审计事件不删除。

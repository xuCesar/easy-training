# 关键业务审计契约

## 1. Scope / Trigger

适用于任何需要机构管理员可追溯的不可逆或高风险写入，包括收款、退款、续费、转课、课次结课和成员权限变更。审计事实写入 `organizationAuditEvent`，并与领域写入使用同一个 PostgreSQL transaction。

## 2. Signatures

- 统一入口：`writeOrganizationAuditEvent(tx, { organizationId, action, entityType, entityId, actorUserId, targetUserId?, campusId?, before?, after? })`。
- Action：`payment_created`、`refund_created`、`enrollment_renewed`、`enrollment_transferred`、`lesson_completed`、`schedule_rule_created`、`schedule_rule_updated`、`schedule_rule_deactivated`、`schedule_rule_deleted`、`lessons_generated`、`lessons_bulk_rescheduled`、`lessons_bulk_cancelled`、`teacher_binding_changed`，以及既有成员与机构操作 action。
- 审计 action 为 `organization_audit_action` PostgreSQL enum；新增值必须同时修改 Drizzle schema、生成 migration、API `auditActionSchema` 和 Web 审计页筛选/标签。

## 3. Contracts

- 审计写入必须紧邻领域写入且使用当前 `tx`；不得在 API 层、提交后的异步任务或独立 DB 连接中补写。
- 业务流水是审计实体：收款/退款用 payment/refund UUID；续费/转课用 enrollmentRenewal/enrollmentTransfer UUID；结课用 lesson UUID。
- 归属校区的资金与课次事件必须写入非 null `campusId`，因为受限校区查询只显示 `campusId` 在授权集合中的事件。
- `before`/`after` 仅记录白名单业务字段。允许金额、日期、方法、课时、状态和关联 UUID/requestId；不得记录 token、联系方式、支付参考号、自由文本备注或退款原因。
- 幂等成功重放必须在审计写入前直接返回已有结果，因此不得新增审计。退款幂等比较必须包含 invoiceId、amountInCents、refundedAt、method 和 reason。

## 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 审计插入失败 | 当前 transaction 回滚，领域流水、余额、课时和状态均不得部分提交 |
| 相同 requestId、相同完整载荷 | 返回既有结果，不新增审计 |
| 相同 requestId、退款 invoiceId 或 refundedAt 不同 | `IDEMPOTENCY_CONFLICT` |
| 新 action 仅改 TypeScript 未迁移 enum | 禁止提交；必须生成并在空库/测试库应用 migration |
| campusId 为空的校区归属事件 | 禁止；受限校区管理员将无法追溯事件 |

## 5. Good / Base / Bad Cases

- Good：财务人员在同一事务创建退款和 `refund_created`，审计 after 只保存金额、方法、退款时间、关联 UUID 与 requestId。
- Base：成员角色/范围变更写入 before/after；`campusAccessMode` 的数据库字段必须与 after 快照一致。
- Bad：将退款原因、支付参考号或学员名单序列化进 after；或在 transaction 提交后再单独插入审计。

## 6. Tests Required

- PostgreSQL 集成测试断言每个关键成功写入恰有一条审计，机构、校区、操作者、实体 UUID 和白名单快照准确。
- 覆盖幂等重放/并发最多一条审计、领域失败零审计，以及审计写入失败时业务事务回滚。
- 覆盖退款 requestId 的 invoiceId/refundedAt 差异冲突。
- 覆盖受限校区能筛选本校区事件；成员角色、校区范围、移除成员审计保留正确 before/after 和失败路径不新增事件。

## 7. Wrong vs Correct

### Wrong

```ts
await db.transaction(createRefund);
await db.insert(organizationAuditEvent).values(event);
```

审计失败会留下无法追溯的退款。

### Correct

```ts
await db.transaction(async (tx) => {
  const refund = await tx.insert(refundTable).values(values).returning({ id: refundTable.id });
  await writeOrganizationAuditEvent(tx, { action: "refund_created", entityId: refund.id, ...event });
});
```

同一 transaction 确保业务事实和审计事实要么同时提交，要么同时回滚。

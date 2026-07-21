# 关键业务审计契约

## 1. Scope / Trigger

适用于任何需要机构管理员可追溯的不可逆或高风险写入，包括收款、退款、续费、转课、课次结课和成员权限变更。审计事实写入 `organizationAuditEvent`，并与领域写入使用同一个 PostgreSQL transaction。

## 2. Signatures

- 统一入口：`writeOrganizationAuditEvent(tx, { organizationId, action, entityType, entityId, actorUserId, targetUserId?, campusId?, before?, after? })`。
- Action：`payment_created`、`payment_reversed`、`refund_created`、`refund_request_submitted`、`refund_request_approved`、`refund_request_rejected`、`refund_request_cancelled`、`enrollment_renewed`、`enrollment_transferred`、`lesson_completed`、`schedule_rule_created`、`schedule_rule_updated`、`schedule_rule_deactivated`、`schedule_rule_deleted`、`lessons_generated`、`lessons_bulk_rescheduled`、`lessons_bulk_cancelled`、`teacher_binding_changed`、`class_paused`、`class_resumed`、`classroom_created`、`classroom_updated`、`classroom_activated`、`classroom_deactivated`、`makeup_lesson_created`、`makeup_lesson_cancelled`、`makeup_lesson_needs_reschedule`，以及既有成员与机构操作 action。
- 审计 action 为 `organization_audit_action` PostgreSQL enum；新增值必须同时修改 Drizzle schema、生成 migration、API `auditActionSchema` 和 Web 审计页筛选/标签。
- 手工开单与账单调整使用 `manual_invoice_created`、`invoice_adjusted`；实体分别使用 `manualInvoiceCreation` 与 `invoiceAdjustment` UUID。

## 3. Contracts

- 审计写入必须紧邻领域写入且使用当前 `tx`；不得在 API 层、提交后的异步任务或独立 DB 连接中补写。
- 业务流水是审计实体：收款/退款用 payment/refund UUID；续费/转课用 enrollmentRenewal/enrollmentTransfer UUID；结课用 lesson UUID。
- 归属校区的资金与课次事件必须写入非 null `campusId`，因为受限校区查询只显示 `campusId` 在授权集合中的事件。
- `before`/`after` 仅记录白名单业务字段。允许金额、日期、方法、课时、状态和关联 UUID/requestId；不得记录 token、联系方式、支付参考号、自由文本备注或退款原因。
- 退款申请的 `reason` 以及批准意见、拒绝原因、取消原因只保存在 `refundRequest/refundRequestEvent`；中央审计仅保存申请/账单/退款 UUID、金额、状态、版本、操作者、校区和 requestId。
- 收款冲正原因只保存在 `paymentReversal.reason`；中央审计 `payment_reversed` 仅保存原收款、账单、冲正金额、时间和 requestId。
- 班级停复课的原因写入 `classStatusEvent.reason`，审计快照只记录状态、`futureLessonPolicy`、受影响课次数量和 requestId；不得把原因或逐课次明细复制进审计 JSON。
- 教室审计允许 `campusId/name/capacity/isActive` 快照；补课审计只记录来源课次、来源报名、目标课次、requestId 或状态迁移，不记录学员姓名、考勤备注或完整名单。
- 目标课次取消、班级停课取消未来课次、规则停用取消未来课次，以及补课学员再次 `absent/leave` 时，从 `scheduled -> needs_reschedule` 的每条补课安排必须写 `makeup_lesson_needs_reschedule`；`after` 只包含状态、目标课次 UUID 与受控原因枚举。
- 幂等成功重放必须在审计写入前直接返回已有结果，因此不得新增审计。退款申请幂等比较包含 invoiceId、amountInCents、refundedAt、method 和 reason；决策比较申请 ID、动作、规范化意见与 expectedVersion。
- 手工开单审计只记录账单/学员/报名 UUID、来源、活动类型、金额、到期日与 requestId；不复制摘要。账单调整审计记录金额/日期关键前后值、版本、`summaryChanged` 与 requestId；详细摘要和调整原因只保存在不可变 adjustment 事实中。

## 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 审计插入失败 | 当前 transaction 回滚，领域流水、余额、课时和状态均不得部分提交 |
| 相同 requestId、相同完整载荷 | 返回既有结果，不新增审计 |
| 相同 requestId、退款申请 invoiceId/refundedAt 或决策载荷不同 | `IDEMPOTENCY_CONFLICT` |
| 新 action 仅改 TypeScript 未迁移 enum | 禁止提交；必须生成并在空库/测试库应用 migration |
| campusId 为空的校区归属事件 | 禁止；受限校区管理员将无法追溯事件 |
| 停复课或补课相同 requestId、相同载荷重放 | 返回既有结果，不新增审计 |
| 停复课或补课相同 requestId、载荷不同 | `IDEMPOTENCY_CONFLICT`，领域状态和审计均不变 |

## 5. Good / Base / Bad Cases

- Good：财务人员在同一事务创建退款和 `refund_created`，审计 after 只保存金额、方法、退款时间、关联 UUID 与 requestId。
- Base：成员角色/范围变更写入 before/after；`campusAccessMode` 的数据库字段必须与 after 快照一致。
- Bad：将退款原因、支付参考号或学员名单序列化进 after；或在 transaction 提交后再单独插入审计。

## 6. Tests Required

- PostgreSQL 集成测试断言每个关键成功写入恰有一条审计，机构、校区、操作者、实体 UUID 和白名单快照准确。
- 覆盖幂等重放/并发最多一条审计、领域失败零审计，以及审计写入失败时业务事务回滚。
- 覆盖退款申请和审批 requestId 的重放/异载荷冲突，并断言申请原因、批准意见、拒绝/取消原因不进入中央审计。
- 覆盖收款冲正成功、重放、超额和并发路径；审计实体为 `paymentReversal` UUID，且中央审计不包含冲正原因。
- 覆盖受限校区能筛选本校区事件；成员角色、校区范围、移除成员审计保留正确 before/after 和失败路径不新增事件。
- 覆盖教室创建/更新/启停、班级停复课和补课创建/取消的 action、entityType、campusId 与白名单快照；权限、容量、状态或审计失败时领域写入全部回滚。
- 覆盖停复课、补课幂等重放不重复写审计，补课结课只沿用 `lesson_completed` 审计且不得暴露补课学员名单。
- 覆盖自动待重排迁移：每条实际变更恰有一条 `makeup_lesson_needs_reschedule`，没有发生状态变化时不新增该审计。
- 覆盖手工开单/账单调整成功、重放、并发和失败路径；中央审计不得包含自由文本摘要、调整原因或学员隐私数据。

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

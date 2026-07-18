# 报名与财务变更契约

## 1. Scope / Trigger

适用于续费、转课、退款与欠费人工跟进。它们同时修改报名、账单或财务流水，必须在 DB repository 的事务中重新读取成员、角色和校区范围；API middleware 的授权快照不能作为最终写入依据。

## 2. Signatures

- `renewEnrollmentRecord({ enrollmentId, addedLessons, amountInCents, dueDate, requestId })`
- `transferEnrollmentRecord({ sourceEnrollmentId, targetCourseId, requestId })`
- `createRefundRecord({ invoiceId, amountInCents, refundedAt, method, reason, requestId })`
- `listArrearsRecords({ organizationId, campusAccess, today })`
- `createInvoiceFollowUpRecord({ invoiceId, note, followedUpAt, requestId })`

持久化事实：`enrollmentRenewal`、`enrollmentTransfer`、`refund`、`invoiceFollowUp`。所有 request ID 在机构内唯一；`payment` 与 `lessonConsumption` 均不可被这些操作删除或改写。

## 3. Contracts

- 续费仅针对 `enrollment.status = active`，在同一事务新增账单、续费流水并增加 `purchasedLessons` 与 `remainingLessons`。
- 转课仅转出来源报名的全部剩余课时，来源报名变为 `transferred`、剩余课时归零且解除班级归属；目标报名金额/已收均为零。本期不自动结算课程差价。
- 退款仅针对已结清账单。退款金额通过 `refund` 流水累计；全额退款才将账单标记为 `refunded`，部分退款仍保留已结清状态。
- 欠费定义为非 `refunded` 且 `amountInCents > paidAmountInCents` 的账单；跟进是追加记录，列表投影最新一条。

## 4. Validation & Error Matrix

| 条件 | 领域错误 | API 语义 |
| --- | --- | --- |
| 成员被撤销或校区越权 | `MEMBER_FORBIDDEN` / `CAMPUS_OUT_OF_SCOPE` | `FORBIDDEN` |
| 校区或目标课程停用 | `CAMPUS_INACTIVE` / `COURSE_INACTIVE` | `CONFLICT` |
| 来源报名已转出、无剩余课时或同课程转课 | `ENROLLMENT_NOT_ACTIVE` / `TRANSFER_NO_REMAINING_LESSONS` / `TRANSFER_SAME_COURSE` | `CONFLICT` |
| 来源有未结清账单 | `TRANSFER_OUTSTANDING_INVOICE` | `CONFLICT` |
| 非已结清账单、超额或重复退款 | `INVOICE_NOT_REFUNDABLE` / `REFUND_EXCEEDS_PAID` / `IDEMPOTENCY_CONFLICT` | `CONFLICT` |
| 已结清或已退款账单的跟进 | `FOLLOW_UP_NOT_ALLOWED` | `CONFLICT` |

## 5. Good / Base / Bad Cases

- Good：财务人员为同校区有效报名续费，重放同一 `requestId` 返回同一账单且不重复加课时。
- Base：部分退款保留历史收款与已结清账单，净收通过退款流水计算；全额退款后账单不可再收款。
- Bad：通过删除 `payment` 抵消退款，或将转课来源的历史账单改指向目标报名。两者都会破坏审计历史。

## 6. Tests Required

- PostgreSQL 集成测试覆盖续费重放/并发、来源欠费阻断转课、课时守恒、跨机构/角色/校区拒绝。
- 覆盖部分与全额退款、退款上限、全额退款后拒绝收款，以及欠费列表的最近跟进投影。
- API 契约测试应断言时间为 ISO 带时区字符串、金额为整数分、错误映射不泄露内部错误。

## 7. Wrong vs Correct

### Wrong

```ts
await tx.update(enrollment).set({ remainingLessons: 0 });
await tx.update(invoice).set({ paidAmountInCents: 0 });
```

这会丢失转课与退款的历史，也不能防止重试重复执行。

### Correct

```ts
await tx.insert(enrollmentTransfer).values(transferEvent);
await tx.insert(refund).values(refundEvent);
// 同一事务内更新来源报名状态或账单状态；收款与课消流水保持不变。
```

以不可变业务流水表达变更，并由机构内唯一请求 ID 和资源锁保证重试安全。

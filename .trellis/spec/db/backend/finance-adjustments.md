# 报名与财务变更契约

## 1. Scope / Trigger

适用于续费、转课、退款与欠费人工跟进。它们同时修改报名、账单或财务流水，必须在 DB repository 的事务中重新读取成员、角色和校区范围；API middleware 的授权快照不能作为最终写入依据。

## 2. Signatures

- `renewEnrollmentRecord({ enrollmentId, addedLessons, amountInCents, dueDate, requestId })`
- `transferEnrollmentRecord({ sourceEnrollmentId, targetCourseId, requestId })`
- `createRefundRequestRecord({ invoiceId, amountInCents, refundedAt, method, reason, requestId })`
- `decideRefundRequestRecord({ refundRequestId, action, comment, expectedVersion, requestId })`
- `cancelRefundRequestRecord({ refundRequestId, reason, expectedVersion, requestId })`
- `createPaymentReversalRecord({ paymentId, amountInCents, reason, reversedAt, requestId })`
- `listArrearsRecords({ organizationId, campusAccess, today })`
- `createInvoiceFollowUpRecord({ invoiceId, note, followedUpAt, requestId })`

持久化事实：`enrollmentRenewal`、`enrollmentTransfer`、`refundRequest`、`refundRequestEvent`、批准后生成的 `refund`、`paymentReversal`、`invoiceFollowUp`。所有 request ID 在机构内唯一；`payment` 与 `lessonConsumption` 均不可被这些操作删除或改写。

## 3. Contracts

- 续费仅针对 `enrollment.status = active`，在同一事务新增账单、续费流水并增加 `purchasedLessons` 与 `remainingLessons`。
- 转课仅转出来源报名的全部剩余课时，来源报名变为 `transferred`、剩余课时归零且解除班级归属；目标报名金额/已收均为零。本期不自动结算课程差价。
- 退款仅针对已结清账单，必须先创建 `pending` 申请；只有非申请人的 `admin/owner` 批准动作可以创建 `refund`。生产代码不得保留或导出直接创建退款的 writer。
- 同一账单最多一条待审批申请；待审批不改变或预占余额。批准时重新锁定申请与账单、复核版本/权限/校区/最新余额，并在同一事务创建唯一退款、更新账单与报名累计已收。全额退款才将账单标记为 `refunded`。
- 申请人可取消自己的待审批申请；`admin/owner` 可取消任意待审批申请。拒绝原因和管理员取消他人的原因必填，终态不可回退。
- 欠费定义为非 `refunded` 且 `amountInCents > paidAmountInCents` 的账单；跟进是追加记录，列表投影最新一条。
- 冲正只引用具体 `payment`，允许多次部分冲正但累计不得超过原收款；原收款始终保留，单笔有效金额为原金额减累计冲正。历史只有账单已收快照、没有具体 `payment` 的金额不可冲正。
- 冲正与实际退款互斥：账单存在任意批准退款事实时禁止冲正；冲正降低账单已收投影并重算状态/`paidAt`，重新产生待收后只能创建新的 `payment`，不得恢复原收款。
- 收款、冲正和退款批准必须在事务内重读财务角色与校区范围，并共享机构锁、账单锁和报名累计已收重算 helper；相同冲正 requestId 同载荷返回原事实，异载荷冲突。
- 续费、转课和退款成功时，在相同事务内分别写入 `enrollment_renewed`、`enrollment_transferred`、`refund_created`；退款申请另写 `refund_request_submitted/approved/rejected/cancelled`。审计实体使用对应不可变流水 UUID，且 before/after 不得包含申请原因或操作意见。

## 4. Validation & Error Matrix

| 条件 | 领域错误 | API 语义 |
| --- | --- | --- |
| 成员被撤销或校区越权 | `MEMBER_FORBIDDEN` / `CAMPUS_OUT_OF_SCOPE` | `FORBIDDEN` |
| 校区或目标课程停用 | `CAMPUS_INACTIVE` / `COURSE_INACTIVE` | `CONFLICT` |
| 来源报名已转出、无剩余课时或同课程转课 | `ENROLLMENT_NOT_ACTIVE` / `TRANSFER_NO_REMAINING_LESSONS` / `TRANSFER_SAME_COURSE` | `CONFLICT` |
| 来源有未结清账单 | `TRANSFER_OUTSTANDING_INVOICE` | `CONFLICT` |
| 非已结清账单、超额、已有待审批或重复请求 | `INVOICE_NOT_REFUNDABLE` / `REFUND_EXCEEDS_PAID` / `PENDING_REQUEST_EXISTS` / `IDEMPOTENCY_CONFLICT` | `CONFLICT` |
| 原收款不存在、已全额冲正或本次超额 | `PAYMENT_NOT_FOUND` / `PAYMENT_ALREADY_REVERSED` / `REVERSAL_EXCEEDS_AVAILABLE` | `NOT_FOUND` / `CONFLICT` |
| 账单已有退款或资金投影陈旧 | `INVOICE_HAS_REFUND` / `REVERSAL_STALE_STATE` | `CONFLICT` |
| 非管理员审批、申请人自审或无权取消 | `MEMBER_FORBIDDEN` / `SELF_APPROVAL_FORBIDDEN` / `CANCELLATION_FORBIDDEN` | `FORBIDDEN` |
| 终态、陈旧版本或批准时余额变化 | `REQUEST_NOT_PENDING` / `REQUEST_VERSION_CONFLICT` / `REFUND_EXCEEDS_PAID` | `CONFLICT` |
| 已结清或已退款账单的跟进 | `FOLLOW_UP_NOT_ALLOWED` | `CONFLICT` |

## 5. Good / Base / Bad Cases

- Good：财务人员为同校区有效报名续费，重放同一 `requestId` 返回同一账单且不重复加课时。
- Base：申请被拒绝或取消时不产生退款；部分批准保留已结清账单，全额批准后账单转为 `refunded` 且仍可按稳定 ID 查看。
- Bad：重新导出旧直退 writer、通过删除 `payment` 抵消退款，或将转课来源的历史账单改指向目标报名。这些做法都会绕过审批或破坏审计历史。

## 6. Tests Required

- PostgreSQL 集成测试覆盖续费重放/并发、来源欠费阻断转课、课时守恒、跨机构/角色/校区拒绝。
- 覆盖四种财务角色申请、仅管理员决策、自审拒绝、取消原因、单待审批、部分/全额退款、退款上限及全额退款后拒绝收款。
- 覆盖创建/决策幂等、同请求异载荷、并发创建/决策、撤权、跨租户/校区、停用校区、版本陈旧和批准时余额变化完整回滚。
- 覆盖部分/多次/全部冲正、超额与全额后再次冲正、历史无 payment、退款互斥、撤权、跨租户/校区和停用校区。
- 覆盖冲正幂等、并发累计上限、冲正与新收款竞态、冲正与退款批准竞态，以及账单/报名/欠费/审计原子一致。
- API 契约测试应断言时间为 ISO 带时区字符串、金额为整数分、错误映射不泄露内部错误。
- 断言成功、幂等重放和冲突路径的审计数量分别为一、一、零；退款重放比较还必须覆盖 invoiceId 与 refundedAt。

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
const request = await createRefundRequestRecord(input);
await decideRefundRequestRecord({
  refundRequestId: request.id,
  action: "approved",
  expectedVersion: request.version,
  requestId,
});
// 只有批准事务可创建 refund；收款与课消流水保持不变。
```

以不可变业务流水表达变更，并由机构内唯一请求 ID 和资源锁保证重试安全。

## Scenario: 欠费周期与跟进历史

### 1. Scope / Trigger

- 适用于真实未收账单（非 `refunded` 且 `amountInCents > paidAmountInCents`）的人工跟进、收款结清和冲正后重新待收。
- 新账单、收款、冲正必须在原财务事务内同步维护欠费周期，禁止由前端或异步任务事后补写。

### 2. Signatures

- `startArrearsCycleIfNeeded(tx, { organizationId, invoiceId, sourceType, sourceId, occurredAt })`
- `resolveArrearsCycleIfNeeded(tx, { organizationId, invoiceId, sourceType, sourceId, occurredAt })`
- `transitionArrearsCycleRecord({ invoiceId, toStatus, promisedPaymentDate?, resumeDate?, reason?, note?, expectedVersion, requestId })`
- `addArrearsNoteRecord({ invoiceId, note, expectedVersion, requestId })`
- API：`training.finance.arrears.list/detail/transition/addNote`。

### 3. Contracts

- `invoiceArrearsCycle` 是当前周期投影；每张账单最多一个未解决周期，以 `cycleNumber` 保留结清后重开的历史。`invoiceArrearsEvent` 仅追加，保存状态变化、备注、操作人、来源与请求标识。
- 状态为 `pending | following_up | promised | paused | resolved`。只有资金事实可自动进入 `resolved`；人工只可设为 `following_up`、`promised` 或 `paused`。
- `promised` 必须提供不早于上海当天的日期；`paused` 必须提供原因，可选恢复日期也不得早于当天。原因和备注只保存在事件表，不能复制进中央审计。
- 人工命令在同一事务按 invoice 再 cycle 的顺序锁定、重新验证财务角色与校区，并以 `expectedVersion` 拒绝覆盖。相同 `requestId` 的同载荷重放必须在版本比较前返回原结果，异载荷冲突。
- 列表只返回授权校区的真实待收账单；支持当前状态和“暂停且未设恢复日期”筛选。详情按轮次倒序、事件正序返回完整历史。
- 迁移保留 `invoiceFollowUp`，把既有记录按原 UUID、requestId、操作者、时间和内容复制为首轮 `note_added` 事件，不再对旧表写入。

### 4. Validation & Error Matrix

| 条件 | 领域错误 | API 语义 |
| --- | --- | --- |
| 账单已结清、已退款或没有开放周期 | `ARREARS_NOT_ACTIVE` / `ARREARS_CYCLE_MISSING` | `CONFLICT` |
| 机构、校区、角色或停用校区不符合 | `MEMBER_FORBIDDEN` / `CAMPUS_OUT_OF_SCOPE` / `CAMPUS_INACTIVE` | `FORBIDDEN` / `CONFLICT` |
| 承诺/恢复日期或暂停原因无效 | `INVALID_ARREARS_INPUT` | `BAD_REQUEST` |
| 版本陈旧或请求标识复用不同载荷 | `ARREARS_VERSION_CONFLICT` / `IDEMPOTENCY_CONFLICT` | `CONFLICT` |

### 5. Good / Base / Bad Cases

- Good：收款使未收归零，在同一事务把开放周期自动标为 `resolved`；之后冲正重新待收时创建下一轮 `pending`，旧轮保持不变。
- Base：暂停追缴但未填写恢复日期，仍出现在“长期暂停”筛选中；追加备注只新增事件，不改变当前状态。
- Bad：将已结清周期恢复为跟进中、把自由文本写进 `organizationAuditEvent`，或在版本检查前拒绝同请求重放。

### 6. Tests Required

- 覆盖新账单、结清和冲正各自与周期/事件/审计同事务提交或回滚；部分收款不覆盖人工状态。
- 覆盖状态与长期暂停筛选、承诺/暂停字段校验、跨机构/校区/停用校区/撤权、陈旧版本、并发与同请求重放。
- 迁移 fixture 必须核对历史 `invoiceFollowUp` 的数量、UUID、请求标识、操作者、时间和备注均可追溯。

### 7. Wrong vs Correct

#### Wrong

```ts
await updateInvoicePaidAmount(invoiceId);
await startArrearsCycleLater(invoiceId);
```

这会在第二步失败时留下真实待收却无周期的账单。

#### Correct

```ts
await db.transaction(async (tx) => {
	await updateInvoicePaidAmount(tx, invoiceId);
	await startArrearsCycleIfNeeded(tx, source);
});
```

账单资金投影、周期、事件和审计在同一事务内完成。

## Scenario: 独立报名与原子建档开单

### 1. Scope / Trigger

- 从学员中心直接为已有学员报名，或同时创建新学员、主要联系人、报名与应收账单时使用。
- 这是跨 DB / API / Web 的写入契约：提交选项只供展示，所有权限、校区、课程、班级与容量条件必须在 repository 事务内重读并复核。

### 2. Signatures

- DB：`createIndependentEnrollmentRecord({ organizationId, operatorUserId, student, courseId, classGroupId, purchasedLessons, amountInCents, invoiceDueDate, requestId })`
- API：`training.enrollments.independentOptions({})`、`training.enrollments.createIndependent(input)`。
- 幂等事实：`enrollmentRegistration` 对 `(organizationId, requestId)` 唯一；其记录保存输入哈希与学员、报名、账单结果。

### 3. Contracts

- `student` 是判别联合：已有学员传 `studentId`；新建学员传姓名、校区及一位主要联系人。新建路径在同一事务中创建所有事实。
- 独立报名固定 `enrollment.leadId = null`，不得伪造招生线索；响应返回 `studentId`、`enrollmentId`、`invoiceId`、可空 `classGroupId` 与 `replayed`。
- 相同 `requestId` 和相同输入重放原结果；相同 request ID 但输入哈希不同返回 `IDEMPOTENCY_CONFLICT`。
- 成功事务写 `enrollment_created` 审计；`after` 只能记录标识、课程/班级、课时、金额、到期日、来源和 requestId，不得写入完整联系电话。

### 4. Validation & Error Matrix

| 条件 | 领域错误 | API 语义 |
| --- | --- | --- |
| 操作者在事务中被撤权或校区越权 | `MEMBER_FORBIDDEN` / `CAMPUS_OUT_OF_SCOPE` | `FORBIDDEN` |
| 学员不存在或为暂停/结业 | `STUDENT_NOT_FOUND` / `STUDENT_NOT_ENROLLABLE` | `NOT_FOUND` / `CONFLICT` |
| 课程、校区停用或不存在 | `COURSE_INACTIVE` / `CAMPUS_INACTIVE` 等 | `CONFLICT` / `NOT_FOUND` |
| 班级课程、校区不匹配，不可报名或容量不足 | `CLASS_*` | `BAD_REQUEST` / `CONFLICT` |
| 同学员已有同课程有效报名 | `ACTIVE_COURSE_ENROLLMENT` | `CONFLICT`，提示改用续费 |
| 顾问覆盖标准课时或价格 | `PACKAGE_TERMS_OVERRIDE_FORBIDDEN` | `FORBIDDEN` |

### 5. Good / Base / Bad Cases

- Good：校区管理员为已有在读学员直接报名并分班，创建一条 `leadId = null` 报名、一张账单和一条审计。
- Base：顾问为新学员创建报名时使用课程标准课时和价格；重放相同 request ID 返回首个报名结果且不新增账单。
- Bad：仅依赖 API middleware 中的角色快照，或允许同一学员重复创建同课程有效报名。这会让撤权并发与多课时账户产生不可追溯的状态。

### 6. Tests Required

- PostgreSQL 集成测试覆盖已有/新建学员、直接入班/暂不分班、事务回滚、同课程报名拒绝及线索转报名的相同行为。
- 覆盖权限撤销、跨机构/校区、停用资源、班级与未来教室容量、顾问套餐越权。
- 断言相同 request ID 重放不增加报名、账单或审计；不同载荷冲突；并发只保留一份结果。
- API 断言 `affectedLessons.startsAt` 序列化为 ISO 字符串，且审计快照不包含完整联系人手机号。

### 7. Wrong vs Correct

#### Wrong

```ts
// 先创建学员，再在事务外创建报名；或只由前端禁用重复提交。
await createStudent(input.student);
await createEnrollment(input);
```

#### Correct

```ts
await db.transaction(async (tx) => {
  const access = await getCurrentWriteCampusAccess(tx, operator);
  const replay = await getReplay(tx, { organizationId, requestId, inputHash, campusAccess: access });
  if (replay) return replay;
  // 事务内复核资源、创建事实、登记幂等结果与审计。
});
```

把建档、报名、账单、幂等和审计作为一个原子操作，并在写入点重读授权。

## Scenario: 手工开单与账单条款调整

### 1. Scope / Trigger

- 财务角色为学员创建材料费、考试费、补差价或其他手工应收，以及调整账单金额、到期日或摘要时使用。
- 手工账单继续使用统一 `invoice` 投影；`manualInvoiceCreation` 与 `invoiceAdjustment` 是不可变的幂等/调整事实。

### 2. Signatures

- `listManualInvoiceOptions({ organizationId, operatorUserId, query?, cursor?, pageSize })`
- `createManualInvoiceRecord({ studentId, enrollmentId?, businessActivityType, summary, amountInCents, dueDate, requestId })`
- `adjustInvoiceRecord({ invoiceId, amountInCents?, dueDate?, summary?, reason, expectedVersion, requestId })`

### 3. Contracts

- 账单来源 `enrollment | renewal | manual` 与可扩展业务活动类型分离；客户端不能指定来源，手工入口只接受手工活动类型子集。
- 手工账单必须关联可访问校区内的学员；可选报名必须属于同一学员且状态为 active/frozen，transferred 不可关联。
- 手工报名关联只用于追溯；报名累计已收只聚合 enrollment/renewal 来源账单，不能因手工账单收款而增加。
- 未收款允许调整金额、日期、摘要；部分收款仅允许日期/摘要；paid/refunded 全部冻结。金额冻结同时检查 `paidAmountInCents`、账单状态和资金流水。
- 调整与收款锁定同一 invoice 行；调整使用 `expectedVersion` 防丢失更新，幂等重放在重新授权后、版本比较前返回原结果。
- 相同 requestId/相同规范化载荷返回原结果且不重复审计；不同载荷返回 `IDEMPOTENCY_CONFLICT`。

### 4. Validation & Error Matrix

| 条件 | 领域错误 | API 语义 |
| --- | --- | --- |
| 成员撤销、角色不允许或校区越权 | `MEMBER_FORBIDDEN` / `CAMPUS_OUT_OF_SCOPE` | `FORBIDDEN` |
| 学员、账单或报名不可见 | `STUDENT_NOT_FOUND` / `INVOICE_NOT_FOUND` / `ENROLLMENT_NOT_FOUND` | `NOT_FOUND` |
| 校区停用或报名已转出 | `CAMPUS_INACTIVE` / `ENROLLMENT_NOT_LINKABLE` | `CONFLICT` |
| 报名与学员不匹配、没有实际变化 | `ENROLLMENT_STUDENT_MISMATCH` / `NO_ADJUSTMENT_CHANGES` | `BAD_REQUEST` |
| 学员选项游标无法解析或结构无效 | `INVALID_CURSOR` | `BAD_REQUEST`，前端从第一页重新加载 |
| 金额冻结、账单冻结或版本陈旧 | `INVOICE_AMOUNT_LOCKED` / `INVOICE_NOT_ADJUSTABLE` / `INVOICE_VERSION_CONFLICT` | `CONFLICT` |
| requestId 已用于不同载荷 | `IDEMPOTENCY_CONFLICT` | `CONFLICT` |

### 5. Tests Required

- PostgreSQL 集成测试覆盖四种财务角色、事务内撤权、租户/校区、停用校区和报名关联状态。
- 学员选项分页覆盖同名学员的 `name + id` 稳定排序、跨页不重复、末页空游标和非法游标拒绝。
- 覆盖创建/调整串行与并发重放、不同载荷冲突、版本竞争和调整/收款竞态。
- 覆盖部分收款字段边界、历史 paidAmount 无 payment、结清/退款冻结，以及失败零领域副作用/零审计。
- 覆盖手工账单进入机构应收和欠费，但收款不改变报名课程累计已收。

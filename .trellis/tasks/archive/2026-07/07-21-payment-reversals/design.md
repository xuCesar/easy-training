# 收款冲正闭环技术设计

## Architecture and Ownership

- 新增 `packages/db/src/repositories/payment-reversals.ts` 承担冲正写入、净额聚合和详情查询。
- 收款与冲正共享账单锁、财务重授权与报名累计已收重算 helper；不复制一套不同金额公式。
- API 路由挂在 `training.finance.paymentReversals`；账单详情返回每笔收款的累计冲正、有效金额与历史。
- Web 从具体收款行发起冲正，不提供账单级或多收款合并入口。

## Data Model

新增 `paymentReversal` 不可变表：

- `organizationId`、`campusId`、`invoiceId`、`paymentId`
- `amountInCents`、`reason`、`reversedAt`
- `operatorUserId`、`operatorName`、`requestId`、`createdAt`

约束与索引：

- 金额为正。
- `(organizationId, requestId)` 唯一。
- `(organizationId, paymentId, reversedAt, id)` 索引用于历史与累计。
- 外键保留原收款和账单；不允许级联删除资金事实。

不在 `payment` 上写“已冲正”标志。单笔有效金额始终由 `payment.amountInCents - sum(paymentReversal.amountInCents)` 推导；账单 `paidAmountInCents` 是所有收款有效金额之和的事务内投影，退款不从该字段扣减。

## Command and Query Contracts

- `createPaymentReversalRecord({ paymentId, amountInCents, reason, reversedAt, requestId, ... })`
- `listPaymentReversalRecords({ invoiceId, campusAccess, ... })`

创建结果包含冲正事实、原收款累计冲正与当前有效金额、账单更新后投影。相同请求相同载荷返回首次结果，不同载荷冲突。

## Transaction and Amount Invariants

固定锁顺序：机构 advisory lock/成员 → invoice `FOR UPDATE` → payment `FOR UPDATE` → enrollment（如有）。

写入流程：

1. 事务内重读财务角色、校区范围和校区启用状态。
2. 锁定原收款所属账单与原收款，处理幂等重放。
3. 查询该账单是否存在任意 `refund`；存在则返回 `INVOICE_HAS_REFUND`。
4. 聚合原收款累计冲正，校验本次金额不超过剩余有效金额。
5. 插入 `paymentReversal`。
6. 将账单 `paidAmountInCents` 减去本次金额；结果为零时状态为 `pending`，大于零且小于应收时为 `partial`，达到应收时为 `paid`；不再结清时清空 `paidAt`。
7. 按现有来源规则原子重算报名累计已收，并写 `payment_reversed` 审计。

账单行锁保证：

- 两次并发冲正不会累计超过原收款。
- 冲正先完成时，后续收款按新待收金额校验并创建新 `payment`。
- 收款先完成时，冲正基于最新账单投影扣减，不会造成超收。
- 退款批准先完成时冲正被退款事实拒绝；冲正先完成时退款批准按最新状态与可退款余额重新校验。

## API and Error Semantics

API：

- `paymentReversals.create(input)`
- 冲正历史合并进 `invoices.detail`，不额外暴露无校区过滤的通用查询。

错误：原收款/账单不存在 `NOT_FOUND`；角色/校区 `FORBIDDEN`；金额非法 `BAD_REQUEST`；超额、完全冲正、已有退款、陈旧资金状态 `CONFLICT`；未知错误使用通用财务错误，不泄露 SQL。

## Web Flow

- 每条收款显示“原金额 / 已冲正 / 有效金额”和冲正记录；完全冲正仍保留该行。
- 有剩余有效金额且账单无退款时显示“冲正”按钮。
- Dialog 默认填入全部剩余可冲正金额，允许改小；原因必填，并明确提示“实际退钱请走退款审批”。
- 已有退款、历史期初已收或完全冲正时禁用入口并显示原因；服务端仍执行最终校验。
- 成功后刷新账单详情、列表、欠费、运营快照和后续凭证状态。

## Compatibility and Rollout

- migration 仅新增表、关系和审计 action，无历史回填。
- 既有 `payment` 全部视为未冲正；历史只有账单已收投影但没有 `payment` 的部分不可操作。
- 一旦生产产生冲正，旧版本 UI 无法展示原因和单笔净额；应用回滚前必须暂停冲正写入并确认旧界面仍能正确解释降低后的账单投影。

## Audit Boundary

新增 `payment_reversed`，实体为冲正 UUID。`after` 保存 invoiceId、paymentId、amountInCents、reversedAt、requestId；不保存 `reason`。

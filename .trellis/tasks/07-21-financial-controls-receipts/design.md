# Issue #29 跨任务技术设计

## Boundary

父任务不拥有业务写入代码，只定义四个子任务共同遵守的资金模型、锁顺序、依赖和发布边界。每个子任务使用独立 migration、repository、API contract、UI 和测试闭环。

## Financial Invariants

- 原始收款：`sum(payment.amountInCents)`。
- 有效收款：原始收款减 `sum(paymentReversal.amountInCents)`；账单 `paidAmountInCents` 保存这一投影。
- 退款：`sum(refund.amountInCents)`，独立于账单已收投影；退款不会重新打开应收。
- 账单待收：`max(invoice.amountInCents - invoice.paidAmountInCents, 0)`。
- 报名累计已收沿用来源过滤，在有效收款基础上再扣除退款。
- 有任何退款事实的账单禁止冲正，避免同一资金既退款又冲正。
- 申请、审批状态、欠费状态和凭证状态均不是资金流水，不得直接参与金额聚合。

## Shared Write Protocol

跨任务写入统一按以下顺序：

1. 机构 advisory lock 与事务内成员/角色/校区重读。
2. invoice `FOR UPDATE`。
3. 具体资金事实或领域聚合行锁。
4. enrollment（如需更新）。
5. 不可变领域事实、当前投影与中央审计同事务提交。

所有 mutation 使用机构范围 UUID requestId；同请求同规范化载荷返回原结果，异载荷冲突。自由文本只留领域表，中央审计仅保存白名单标识和状态。

## Dependency Flow

```text
refund approval
  └─ defines approved refund fact and removes direct bypass
payment reversal
  └─ consumes refund fact and can reopen receivable
arrears workflow
  └─ consumes receivable transitions and persists cycles
receipt documents
  └─ consumes final payment/reversal/refund view
```

## Compatibility

- 所有 schema migration 以 additive 为主，不删除既有 payment/refund/follow-up。
- 历史 refund 视为有效退款，但不伪造审批申请。
- 历史无具体 payment 的账单已收不能冲正或生成收款凭证。
- 旧 follow-up 复制进新欠费事件后，原表首版保留只读。
- 历史 payment 初始均为未冲正、未开具凭证。

## Rollout and Rollback

- 严格按四个子任务顺序发布，每项先迁移、再应用、再验证并归档。
- 每个子任务完成后运行全量财务集成回归，下一项不能建立在未归档的临时契约上。
- 一旦产生新领域事实，回滚应用前暂停对应 mutation；数据库事实与编号不得逆向删除或复用。
- 最终集成检查覆盖金额守恒、授权、中央审计、查询聚合和桌面/移动端完整路径。

# 收款冲正闭环实施计划

## Scope Guard

- 只对具体 `payment` 建立不可变部分/全部冲正。
- 不提供实际退款、账单级负数调整或已退款账单修正。
- 依赖退款审批子任务已完成并通过检查。

## Implementation Checklist

1. 数据库与迁移
   - 新增 `paymentReversal` 表、关系、正金额 check、机构请求唯一索引和收款历史索引。
   - 增加 `payment_reversed` 审计 action 并生成 additive migration。
2. 共享金额 helper
   - 将报名累计已收重算和账单状态重算收敛为 DB 内部 helper，确保 payment、refund approval、reversal 使用一致公式。
   - 明确退款不降低 invoice 已收投影，冲正必须降低。
3. DB repository
   - 新建 `packages/db/src/repositories/payment-reversals.ts`。
   - 实现固定锁顺序、事务内重授权、退款存在性检查、累计冲正校验、幂等与唯一冲突恢复。
   - 原子更新 invoice、enrollment 和 audit；使现有 `createPaymentRecord` 在冲正后重新开放账单时继续可用。
   - 扩展账单详情批量返回冲正，避免逐 payment N+1。
4. API
   - 增加 create contract、冲正 record 和 payment 有效金额字段。
   - 增加领域错误映射并挂载 `training.finance.paymentReversals.create`。
5. Web
   - 收款行展示原金额、累计冲正、有效金额和历史。
   - 新增冲正 Dialog：默认剩余全额、金额可编辑、原因必填，并显示与实际退款的区别。
   - 成功后失效账单、欠费、Dashboard 和后续凭证相关 query。
   - 更新审计页 action/entity 标签。
6. 规范
   - 在财务变更规范中记录净额公式、退款互斥和新收款规则。

## Required Tests

- 部分一次、多次部分、完全冲正及完全后再次冲正。
- 超额、历史无 payment 已收、任意 refund 存在、越权、跨校区、停用校区、事务中撤权。
- requestId 同载荷重放、异载荷冲突、两次并发冲正累计不超额。
- 冲正与新收款并发、冲正与退款批准并发的两个提交顺序。
- invoice `paidAmountInCents/status/paidAt`、enrollment paid、欠费列表与审计同时成功或同时回滚。
- Web 覆盖禁用原因、字段错误、提交中状态和原收款始终可见。

## Validation Commands

```bash
pnpm db:generate
pnpm check-types
pnpm --filter server exec tsx --test ../../packages/db/tests/payment-reversals.integration.ts
pnpm check
pnpm build
pnpm test:integration
```

## Review Gates and Rollback

- Gate 1：金额公式由一处 helper 所有，refund 不会被重复从 invoice 已收扣除。
- Gate 2：数据库并发测试证明累计冲正上限与退款互斥。
- Gate 3：冲正后普通收款实际可用且生成新 payment。
- Gate 4：桌面/移动端实际验证部分、全部和不可冲正三类状态。
- 生产产生冲正后，回滚旧 UI 前暂停写入并确认账单投影仍可解释；数据库流水不得删除或反向迁移。

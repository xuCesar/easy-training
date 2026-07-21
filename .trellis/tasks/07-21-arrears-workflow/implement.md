# 欠费处理工作流实施计划

## Scope Guard

- 只实现账单待收的状态、轮次、事件和筛选，不发送通知、不做外部催收。
- 依赖收款冲正子任务完成，自动迁移必须与新建账单、收款、冲正原事务集成。
- 首版保留旧 `invoiceFollowUp` 表，不执行破坏性删除。

## Implementation Checklist

1. 数据库与迁移
   - 新增状态/事件枚举、`invoiceArrearsCycle`、`invoiceArrearsEvent`、关系、开放周期部分唯一索引和幂等索引。
   - 编写可重复验证的 backfill SQL：创建首轮周期、复制旧 follow-up，并保留原表。
   - 增加 `arrears_status_changed` 审计 action。
2. 生命周期 repository
   - 新建 `packages/db/src/repositories/arrears-workflow.ts`。
   - 实现 start/resolve helper、列表、详情、人工迁移和追加备注。
   - 统一上海自然日校验、固定 invoice→cycle 锁顺序、版本与幂等处理。
3. 接入资金与开单事务
   - 在招生线索转报名、独立报名、续费开单和手工开单成功事务中为正待收创建首轮周期；零应收不创建。
   - 在 payment 结清事务中自动解决开放周期。
   - 在 reversal 重新产生待收事务中开启新周期；本来已待收时不重建周期。
   - 为审计失败、周期唯一冲突和资金写入失败补原子回滚测试。
4. API
   - 扩展 arrears list 的状态筛选与当前投影；增加 detail、transition、addNote contracts。
   - 旧 `followUp` mutation 停止写旧表，Web 切换后移除公开入口。
5. Web
   - 将 `finance-adjustments.tsx` 的简化卡片拆分/升级为完整欠费列表组件。
   - 增加状态筛选、最近操作、承诺/恢复日期和历史 Sheet/Dialog。
   - 表单按目标状态显示字段，版本冲突保留输入并提供刷新。
   - 桌面表格和移动卡片都保证长期暂停可发现。
6. 文档与运维核对
   - 更新财务规范的欠费定义、自动迁移和历史兼容说明。
   - 记录 migration 前后数据核对 SQL 与回滚限制。

## Required Tests

- migration fixture 覆盖：当前待收无跟进、当前待收有跟进、已结清有历史跟进、无关账单；核对旧备注逐条可追溯。
- 各类新账单正金额自动 pending，零应收不创建周期。
- payment 部分收款不改变人工状态，结清自动 resolved；reversal 后新一轮 pending 且旧轮不变。
- promised 日期、paused 原因/恢复日期、未结清人工 resolved、无效迁移和 expectedVersion 冲突。
- 四角色、校区范围、停用校区、事务中撤权和不同机构隔离。
- 资金事务或审计失败时余额、周期、事件均回滚。
- 列表只含真实待收，状态筛选、排序和长期暂停结果正确。

## Validation Commands

```bash
pnpm db:generate
pnpm check-types
pnpm --filter server exec tsx --test ../../packages/db/tests/arrears-workflow.integration.ts
pnpm check
pnpm build
pnpm test:integration
```

迁移还需在包含旧 follow-up fixture 的临时测试库实际执行并运行核对 SQL。

## Review Gates and Rollback

- Gate 1：backfill 数量、requestId、操作者、时间和备注核对无损。
- Gate 2：所有产生/消除待收的已知写路径均调用生命周期 helper。
- Gate 3：并发资金与人工状态测试通过，不存在“待收无开放周期”或“结清仍开放”。
- Gate 4：桌面/移动端实际验证筛选、动态表单和多轮历史。
- 回滚应用前暂停新状态写入；旧 follow-up 表仍可供旧版读取，新事件表保留且不做逆向删除。

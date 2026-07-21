# 退款审批闭环实施计划

## Scope Guard

- 只实现退款申请、审批、拒绝、取消和批准后创建现有 `refund`。
- 不提前实现冲正、欠费状态或凭证；只保留后续查询所需稳定字段。
- 不删除历史 `refund`，不迁移为伪申请。

## Implementation Checklist

1. 数据库与迁移
   - 在 `packages/db/src/schema/training.ts` 增加申请/事件枚举、表、关系、check、唯一及部分唯一索引。
   - 扩展中央审计 action。
   - 使用 `pnpm db:generate` 生成 additive migration，人工检查 SQL 不包含破坏性 drop 或错误 enum 重建。
2. DB repository
   - 新建 `packages/db/src/repositories/refund-approval.ts`，实现列表、创建、审批、拒绝和取消。
   - 抽取并复用退款资金写入与报名累计已收重算逻辑，避免新旧路径金额公式分叉。
   - 所有写入采用事务内重授权、固定锁顺序、版本与幂等比较；唯一冲突后读取首次结果。
   - 从 `packages/db/src/index.ts` 导出。
3. API contract 与路由
   - 在 `packages/api/src/contracts/training.ts` 增加判别联合输入、结果、状态和历史 schema。
   - 新建 API repository 完成时间、付款方式映射及领域错误到 ORPC 错误的翻译。
   - 在 `packages/api/src/routers/index.ts` 挂载 `refundRequests`，移除公开直接退款 mutation。
   - 扩展 invoice list/detail 的 `refunded` 状态与筛选，移除详情读取对 refunded 的硬排除，同时保持默认 open 过滤不变。
4. Web
   - 修改 `apps/web/src/features/training/finance-workspace.tsx`：退款入口改申请、展示待审批和历史。
   - 增加“已退款”筛选，保证全额退款后仍能查看原账单与审批链。
   - 将审批/取消表单拆到职责清晰的新组件，复用系统 Dialog、Field、Toast 和查询失效模式。
   - 根据角色和申请人显示操作，但不以 UI 隐藏代替服务端授权。
   - 更新审计页 action 标签和 entity 标签。
5. 文档与规范
   - 更新 `.trellis/spec/db/backend/finance-adjustments.md`，将直接退款契约改为审批契约。
   - 更新 `.trellis/spec/db/backend/audit.md` 的 action 与自由文本边界。

## Required Tests

- 新建或扩展 PostgreSQL 集成测试，覆盖四角色提交、仅 admin/owner 决策、自审批拒绝、事务中撤权、跨校区和停用校区。
- 覆盖同账单待审批部分唯一、同请求重放/不同载荷冲突、并发创建和并发决策。
- 覆盖拒绝/取消零退款，批准恰好一条退款，以及余额/版本变化时完整回滚。
- 覆盖申请人取消、管理员取消他人的原因规则和中央审计自由文本白名单。
- API contract 覆盖判别联合与明确错误消息；Web 手工验证按钮权限、加载/错误/空态和提交中关闭保护。

## Validation Commands

```bash
pnpm db:generate
pnpm check-types
pnpm --filter server exec tsx --test ../../packages/db/tests/refund-approval.integration.ts
pnpm check
pnpm build
```

若测试加入现有 `finance.integration.ts`，使用对应现有路径；最终仍需运行 `pnpm test:integration`。

## Review Gates and Rollback

- Gate 1：migration 审查通过，旧退款行无需回填且旧读取仍可用。
- Gate 2：证明公开路由不存在直接创建退款的旁路。
- Gate 3：并发审批、余额变化和审计失败均有 PostgreSQL 事务证据。
- Gate 4：桌面和 360–390px 移动端完成申请、审批、拒绝、取消实际验证。
- 回滚前暂停新申请写入；数据库表保留。若应用回滚到直接退款版本，必须同时在部署层禁用旧退款 mutation，避免审批控制失效。

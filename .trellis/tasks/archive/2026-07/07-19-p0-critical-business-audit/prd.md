# P0 关键业务审计追溯

## Goal

为资金、报名课时和课次结课这些不可逆或高风险写入补齐事务内审计，使机构管理员能够可靠追溯发生了什么、由谁操作、作用于哪个校区与业务实体。

## Confirmed Facts

- `organizationAuditEvent` 已是机构审计的单一持久化表；`action` 为 PostgreSQL enum，审计查询按 `campusId` 执行校区范围过滤。
- 校区、成员角色/范围、邀请和线索导入等部分操作已有同事务审计；收款、退款、续费、转课及课次结课尚未写审计。
- 付款、退款、续费、转课和课次结课均已在各自 repository 的数据库事务内完成业务写入；应在同一事务末尾写入审计，而非经 API 或异步补偿。
- `createRefundRecord` 的幂等回放比较未包含 `invoiceId` 与 `refundedAt`，同一 requestId 的不一致请求可能被错误接受。

## Requirements

### R1：补齐关键事件

- 成功收款写入 `payment_created`，实体为 payment。
- 成功退款写入 `refund_created`，实体为 refund。
- 成功续费写入 `enrollment_renewed`，实体为 enrollment renewal 流水。
- 成功转课写入 `enrollment_transferred`，实体为 enrollment transfer 流水。
- 成功完成课次写入 `lesson_completed`，实体为 lesson。
- 复核并补充既有成员角色、校区范围调整和移除成员的审计回归测试；不重复实现已有审计。

### R2：原子性、幂等与隐私

- 每个新事件必须与相应业务写入处于同一 PostgreSQL 事务；审计插入失败时业务写入整体回滚。
- 幂等成功重放不得新增第二条审计记录；相同幂等键而业务字段不一致时维持既有冲突语义。
- 事件快照只记录白名单业务字段：金额、课时、状态、日期、关联 UUID、支付/退款方式和 requestId；不得记录 token、完整联系方式或支付参考号。
- 所有资金和课次事件必须填入对应的 `campusId`，以保持审计查询的校区授权边界。

### R3：跨层契约

- 新 action 同步 PostgreSQL enum/schema migration、API 输入输出 schema、审计页面筛选项与对象文案。
- 现有审计 endpoint、分页和校区授权模型保持兼容；不暴露新增快照字段给当前列表 API。
- 退款幂等判断同步纳入 `invoiceId` 和 `refundedAt`。

## Acceptance Criteria

- [ ] 五类成功业务操作各产生一条可查询、含正确机构/校区/操作者/实体的审计记录。
- [ ] 对每类操作，审计失败会回滚业务写入；成功幂等回放不重复写审计。
- [ ] 退款同 requestId 但 invoiceId 或 refundedAt 不一致时拒绝，且不产生额外退款或审计。
- [ ] 成员角色、校区范围和移除成员的已有审计以集成测试确认 before/after、失败回滚及最后 owner 保护不回归。
- [ ] 新事件可由 API 审计列表筛选并在 Web 审计页以中文展示；校区管理员只看到授权校区事件。
- [ ] 迁移、类型检查、Biome、相关 PostgreSQL 集成测试和生产构建通过。

## Out of Scope

- 班级结课专用事件、支付网关回调、外部 SIEM/APM 投递与审计日志导出。
- 修改既有历史审计数据或向外公开 before/after 详情查看接口。

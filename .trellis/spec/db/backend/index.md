# Database 后端规范

- 先加载 [项目级工程约束](../../guides/project-conventions.md)。
- 使用 PostgreSQL + Drizzle；schema 位于 `packages/db/src/schema`，repository 位于 `packages/db/src/repositories`，migration 位于 `packages/db/src/migrations`。
- 领域表必须显式包含并查询 `organizationId`；跨表读取同时校验关联记录属于同一机构，不能只按资源 ID 查询。
- 机构内唯一性使用包含 `organizationId` 的唯一索引；为实际筛选、排序和关联路径设计索引，避免仅凭猜测新增索引。
- 金额列使用整数分并采用 `*InCents` 命名；时间点使用 `timestamp(..., { withTimezone: true })`。
- 多步业务写入（例如线索转化、账单和收款）需要事务、幂等键或唯一约束保护，不能留下部分成功状态。
- schema 变更先生成并审查 migration；考虑旧数据回填、nullable/default、外键删除行为、锁表风险和回滚，不直接使用破坏性 `db:push` 处理生产数据。
- 权限、机构隔离、幂等和财务写入优先在 `packages/db/tests` 增加 PostgreSQL 集成测试。
- 涉及多校区、成员范围和邀请时，加载 [机构管理契约](organization-management.md)。
- 涉及课程、教师、班级和课次时，加载 [教务主数据与排课契约](teaching.md)。
- 涉及续费、转课、退款或欠费跟进时，加载 [报名与财务变更契约](finance-adjustments.md)。

# 技术设计：P2 财务经营分析

## 1. Boundary and Reuse

数据流固定为：

```text
开单事务 -> invoice + invoiceMetricFact
不可变资金/调整事实 -> DB 历史重放查询
DB record -> API 指标内核/registry -> oRPC 契约
后续 analytics/T7 -> 同一 registry
```

- `packages/db` 负责稳定归属事实、历史重放和机构/校区 SQL 边界。
- `packages/api` 复用 `business-metrics-time.ts`、ratio/envelope/registry，负责角色授权、错误映射和 ISO 序列化。
- 本子任务不实现最终页面；只提供后续 UI/T7 可直接消费的版本化结果和受控下钻。
- 现有 `invoice` 当前投影、财务写入语义和 `/finance` 页面保持不变。

## 2. Additive Data Model

新增一对一不可变 `invoice_metric_fact`，建议字段：

- `invoiceId` 主键、`organizationId`。
- `campusAttributionKind=linked|unknown`；linked 时 `campusId`、`campusNameSnapshot` 必须同时存在。
- `courseAttributionKind=linked|not_applicable|unknown`；linked 时 `courseId`、`courseNameSnapshot` 必须同时存在，not_applicable 专指合法无课程的其他业务，unknown 专指历史无法证明。
- `source` 与 `provenance=native|derived`，用于区分新写事实和可证明迁移。
- `occurredAt` 与账单 `issuedAt` 一致，便于覆盖审计；事实创建后不更新。

约束与索引：

- `(organizationId, invoiceId)` 唯一；为 invoice/campus/course 建立所需复合候选键并使用 `(organizationId,resourceId)` 复合外键，数据库层阻止跨机构归属错配。
- 查询索引以 `(organizationId,campusId,occurredAt,invoiceId)` 为主；课程索引只有 explain 证明需要时添加。
- FK 使用保守删除策略；名称快照保证资源停用或后续更名不改写历史展示。
- `provenance=native` 必须满足 campus linked；课程只能 linked 或 not_applicable。迁移为每张高水位内旧账单创建 derived fact，无法证明时显式使用 unknown，而不是让 null 同时表达多种含义。

四类 writer 在原事务插入事实：

1. 线索转化开单：校区来自转化发生时快照，课程来自已验证课程。
2. 独立报名开单：校区来自报名发生时校区，课程来自已验证课程。
3. 续费开单：校区来自本次购买周期发生时校区，课程来自报名课程。
4. 手工开单：校区来自已验证学员发生时校区；有报名才保存课程，否则为空并归入其他业务。

回填仅证明链路：`enrollmentRegistration`、`enrollmentRenewal + enrollmentPurchaseCycle`、`manualInvoiceCreation`、线索转化报名的稳定成交校区。不能由这些事实证明的旧账单不使用 `student.campusId` 猜测，使用 unknown 状态；合法无课程的手工其他业务使用 not_applicable。

## 3. Replay Semantics

### 3.1 Invoice Terms at a Cutoff

对 `issuedAt < cutoff` 的账单：

- 若截止前存在 adjustment，取最后一条 `afterAmount/afterDueDate`。
- 若首条 adjustment 在截止后，使用其 `beforeAmount/beforeDueDate` 重建初始条款。
- 若没有 adjustment，当前 amount/dueDate 即原始条款；paid/refunded 后现有规则禁止继续调整。
- adjustment 按 `(createdAt,afterVersion,id)` 稳定排序；验证首条 `beforeVersion=1`、相邻 version 与 before/after 值首尾衔接、末条和当前 invoice version/value 一致。
- 重复、分叉、缺口或尾部不一致计入 adjustment chain 异常，并从依赖该历史的比例/历史账龄中排除；新增 `(organizationId,invoiceId,afterVersion)` 唯一索引前先执行存量重复预检。

### 3.2 Net Receipt

事件联合采用统一投影 `{ id, invoiceId, occurredAt, kind, signedAmountInCents }`：

- payment：正数。
- payment reversal：负数。
- approved refund 生成的 refund：负数。

每个事件按自身时间落入上海日/周/月桶；不把反向事实追溯改写到原 payment 日期。趋势 schema 允许负整数。

### 3.3 30-day Cohort

- cohort 范围只筛 `invoice.issuedAt`，观察窗为 `[issuedAt, issuedAt + 30 days)`。
- `windowEnd <= asOf` 才成熟；未成熟数量与最短剩余日单列。
- 分母为 `windowEnd` 前有效 invoice terms；分子为窗口内 payment - reversal - refund。
- 窗口后的资金与 adjustment 不回写指标；零金额账单只计数量，不增加金额分母。
- 缺少可重放资金事实或调整链的账单不从当前 paid 投影补造，返回 `factCoverageMissing`。
- 零金额赠送账单不需要 payment 事实，不计入资金覆盖缺口。
- eventAt 早于 issuedAt，或净分子落在 `[0,denominator]` 之外时，计 chronology/settlement anomaly 并排除该账单；ratio 继续保持非负契约，不做静默截断。

### 3.4 Aging Snapshot

快照时点为 `min(range.to, asOf)`。每张账单：

- 条款使用 cutoff replay。
- settlement coverage 使用 cutoff 前 payment - reversal；refund 不减少 settlement coverage，避免退款重新制造应收。
- `outstanding=max(amount-settlement,0)` 仅用于正常链路；负余额/超额结算先计质量异常，不能静默裁剪后宣称数据完整。
- refund 只进入净回款，不参与 outstanding 公式；出现 refund > settlement、退款账单 settlement 不足或超额结算时计异常并排除，不能用全额退款分支掩盖不一致。
- 上海日期差分桶为 notDue、overdue1To30、overdue31To60、overdue61To90、overdueOver90；到期日次日开始逾期。

## 4. API Contract and Registry

- `BusinessMetricQueryInput` 继续作为 summary 输入。
- 新增 financial result：共享 envelope + signed net receipt trend + 主/对比汇总 + cohort ratio/counts + aging buckets + financial data quality。
- 扩展受控 drilldown kind 为财务事件和应收账单；最大 50 条，稳定复合游标，响应不包含学员联系方式、备注或原因。
- `businessMetricDefinitionRegistry.financial` 是唯一领域入口；发布时保留 `contractVersion=1`，新增 `FINANCIAL_METRIC_DEFINITION_VERSION` 或等价逐指标版本映射，既有四类 definitionVersion 不变。跨版本契约测试证明旧结果仍可由旧客户端 schema 解析。
- `financeManagementRoles` 作为允许集合；repository 仍显式接收服务端解析的 organizationId/campusAccess，不能相信 input。
- owner/admin 全机构查询可包含“未归属”分组和定量缺口；selected/none campus scope 只聚合能够证明属于授权校区的事实，不返回机构级未归属计数或金额，仅返回非定量 `scopeCoverageIncomplete`，防止侧信道泄露。

## 5. Query Shape and Performance

- DB 入口拆为 `getFinancialMetricSummaryRecord` 与 `getFinancialMetricDrilldownRecords`，内部共享 invoice attribution、terms replay 和 signed event CTE，避免 summary/drilldown 口径漂移。
- 主范围、对比范围和 aging cutoff 可并行，但同一请求必须使用同一注入 `asOf`。
- 范围最长两年；先在 PostgreSQL 固定 fixture 运行 explain，再在部署前真实数据量复核。只有实际慢路径才补索引；不引入缓存、物化视图或异步汇总。

## 6. Compatibility, Rollout, and Rollback

1. 第一阶段 additive migration 只创建事实表、状态约束和经存量预检安全的索引，不执行 backfill。
2. 部署四类 writer 同事务双写；事实写入失败必须回滚原开单，并设置不可回退到无 writer 版本的部署下限。
3. 记录 invoice 高水位，运行可重入 backfill；随后 catch-up 高水位后的缺口并执行 reconciliation，重复运行不得覆盖 native fact。
4. 固定 fixture 与 shadow read 核对当前区间总额、历史 cutoff、归属三态和覆盖缺口。
5. 通过门禁后发布 reader/下钻；最终页面由后续子任务开放。

回滚 reader 时保留 schema、事实与 writer。部署策略明确 writer 版本下限，禁止任何继续开单但不写 fact 的应用版本恢复流量。

## 7. Main Risks

- 历史账单没有稳定校区：宁可报告缺口，不用学员当前校区猜测。
- refund 与 receivable 语义混淆：退款影响净回款，但不把已结算账单重新变成欠费。
- 调整发生在查询 cutoff 后：必须读取首条 adjustment 的 before 值，不能使用 invoice 当前投影。
- 小数据 explain 使用顺序扫描并不证明生产性能；生产真实数据量 explain 是开放 reader 的部署门禁。

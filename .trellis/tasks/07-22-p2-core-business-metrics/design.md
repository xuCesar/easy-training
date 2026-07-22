# 技术设计

## 1. 架构边界

本任务继续沿用现有四层结构，不新增依赖或分析基础设施：

- `packages/db` 保存稳定经营事实、执行事件时校区/归属裁剪并返回类型化聚合结果；写路径负责事务、幂等、唯一约束和审计。
- `packages/api` 定义版本化 Zod/oRPC 契约、统一时间范围解析、指标定义、成熟度、数据质量和角色投影；router 只装配服务端机构上下文与错误映射。
- `apps/web` 新增独立经营分析路由和展示组件，只消费服务端值、分子/分母及趋势，不重新计算指标。
- `apps/server` 沿用现有 oRPC 装配，不增加 worker、缓存或后台聚合任务。

现有 `training.snapshot` 保持“今日工作台”实时快照语义，不扩展为历史分析接口。新增 `getBusinessMetrics(scope, query)` 作为 T5/T6/T7 唯一指标领域入口；DB repository 不自行决定产品口径，Web、下钻和报表不得直接拼 SQL 或复制公式。

## 2. 统一时间与指标契约

在 `packages/api` 建立共享指标契约和纯函数时间解析器：

```ts
type MetricRangeInput =
	| { preset: "last7Days" | "last30Days" | "last90Days" | "month" | "quarter" | "year" }
	| { preset: "custom"; from: string; to: string };

type MetricEnvelope<T> = {
	contractVersion: "1";
	definitionVersion: "2026-07-01";
	timezone: "Asia/Shanghai";
	asOf: string;
	range: ResolvedMetricRange;
	comparisonRange: ResolvedMetricRange;
	granularity: "day" | "week" | "month";
	dataQuality: MetricDataQuality;
	data: T;
};
```

输入只接受预设或上海自然日期，不接受客户端提供的机构、校区、顾问或教师授权范围。服务端一次解析主范围、对比范围和粒度，并显式传给所有 repository。范围左闭右开；周以周一开始。测试注入 `now`，避免本地时区和执行日期导致金值漂移。

数值指标使用判别联合：`available` 包含 value/numerator/denominator，`notApplicable` 包含稳定原因 `noDenominator | immatureCohort | insufficientSample | factCoverageMissing`。不以 `0`、空数组或 `null` 混淆真实零值、无权和不可计算。

首期按页面区块暴露 `sales`、`attendance`、`consumption`、`renewal` 查询；它们共享 envelope、scope 和定义注册表。T6 可在注册表上增加维度，T7 按视图调用同一 service 并固化 `definitionVersion`。

## 3. 招生稳定事实

对现有 schema 做 additive 扩展：

### 3.1 线索归属

- `lead` 增加可空 `providerUserId`、`providerNameSnapshot`、`createdCampusId` 和 `currentCycleNumber default 1`。提供人在创建/导入后冻结；当前 `ownerUserId` 继续表示可变负责人。
- 新增 `lead_owner_assignment_event`：机构、线索、发生时校区、前后负责人 ID/姓名快照、操作人、来源、requestId、occurredAt。新线索写初始事件，后续负责人变化只追加事件。
- 删除用户时可让外键 ID 置空，但姓名快照和事实保留；姓名快照只对管理角色或本人返回，不进入顾问同业下钻。

### 3.2 里程碑与结案周期

新增 append-only `lead_milestone_event`：

- `kind = contacted | trial_booked | lost | reopened | converted`
- `cycleNumber`、发生时 `campusId`、可空提供人和结案归属 ID/姓名快照
- `occurredAt`、操作人、来源类型/ID、requestId

每个周期的 contacted/trial_booked/lost/converted 使用机构、线索、周期和 kind 唯一约束，只记录首次真实发生。`lost` 或 `converted` 是该周期唯一结论；从 lost 更新为开放阶段时，锁定线索、递增 cycleNumber 并追加 reopened。已转化线索保持现有终态，不能重开。跳过阶段时只写实际阶段，不补造 contacted 或 trial_booked。

线索创建、导入、资料更新、跟进、流失、重开和转化必须在现有事务中同步写归属/里程碑。负责人变化不从 operator 推断；结案归属默认结案时当前负责人，但允许既有转化表单显式选择并冻结。

### 3.3 直接报名与成交快照

- `enrollmentRegistration` 增加可空兼容字段 `source`、`providerUserId/providerNameSnapshot`；新 API 写入要求来源非空，旧记录保持 null 并进入数据质量计数。
- `enrollment` 继续使用已有 `conversionOwnerUserId`，增加 `conversionOwnerNameSnapshot` 和 `conversionCampusId`，供线索转化与直接报名共同固化发生时事实。
- 线索转化以 lead milestone 作为结案时间；直接报名以 registration.createdAt 作为发生时间。二者均不使用学员当前校区或当前负责人重算历史。

## 4. 购买周期与续费机会

新增 `enrollment_purchase_cycle`：机构、报名、递增 sequence、来源 `initial | renewal`、来源 registration/renewal ID、本周期购买课时、开始时剩余课时、成交金额、发生时校区、startedAt。`(enrollmentId, sequence)`、来源事实分别唯一。

新增 append-only `renewal_opportunity`：机构、报名、purchaseCycleId、触发课消 ID、阈值、触发后剩余课时、发生时校区、triggeredAt；每个购买周期最多一条。新增 `renewal_opportunity_conversion`：opportunityId、renewalId、convertedAt，每个机会和续费分别最多关联一次。

初始报名和续费事务创建购买周期。结课事务在写入 `lessonConsumption` 并扣减余额后，以当前购买周期阈值判断：只有从阈值上方首次进入阈值或以下时插入机会；唯一约束保证重放和并发不重复。

续费事务在增加课时前锁定当前周期和开放机会：

- 存在仍在 30 个有效观察日内的机会时，写 conversion 并开启新周期；续费创建即成功，不等待付款。
- 不存在机会时标记为提前续费并开启新周期，不进入机会分母。
- 转课沿用现有 transfer 事实，目标报名周期标记 `transfer` provenance，仅用于课程延续诊断，不作为续费。

冻结/复课继续以 `enrollmentLifecycleEvent` 为唯一事实。指标 service 按机会触发后的 frozen/resumed 区间扣除暂停时长，得到有效观察截止时间；当前仍冻结则机会保持未成熟。不上线前余额倒推历史 trigger；无法证明的旧报名返回 coverage 缺口，只有上线后新周期/新触发进入机会 cohort。

## 5. 到课、补课与消课查询

主到课查询只读取 `lesson.status=completed`。正常班级应到成员必须复用或抽取现有教务“按 lesson.startsAt 回放 enrollmentLifecycleEvent”的成员解析内核，不能用 enrollment 当前 class/status 连接历史考勤。

- 正常成员的 present/late/absent/leave 进入主到课分母。
- 与 `makeupLesson.targetLessonId + sourceEnrollmentId` 匹配的补课成员从主到课排除；fulfilled 为补课完成，scheduled/needs_reschedule 分别进入未完成/待重排。
- 一节课中正常成员和补课成员可以同时存在，查询按 enrollment 身份而不是整节课是否含补课来分类。

消课按 `lessonConsumption -> lesson.startsAt` 聚合，正常课和完成补课的真实课消都计入。`consumedAt` 只计算录入延迟；超过 lesson.endsAt 24 小时进入 `lateConsumptionCount`。跨表查询始终同时限定 organizationId，并使用 lesson 的发生时 campus/teacher。

## 6. 权限与隐私投影

新增独立角色—指标—范围矩阵，不复用当前 dashboard 仅按角色开关的宽松逻辑：

- owner/admin：全机构全部 T5 指标。
- campus_manager：只查询授权校区，历史事实使用事件/课次发生时 campusId。
- consultant：sales repository 只允许 `providerUserId = userId`、结案归属 `= userId` 或直接报名成交归属 `= userId` 的本人投影；校区基准只返回聚合值。
- teacher：attendance/consumption 仅以 `teacher.userId = userId` 对应课次查询；不接受客户端 teacherId 扩大范围。
- finance：T5 router 直接返回 `FORBIDDEN`。

顾问校区基准在所选范围内有效结案周期少于 5 时返回 `insufficientSample`。响应不包含其他顾问 ID、姓名、逐人序列或可反推的未分配数量。owner/admin/campus_manager 才能看到未分配桶和实名管理下钻。

## 7. Repository、API 与 UI 数据流

```text
当前会话/机构成员
  -> API 解析 role + campusAccess + userId + 时间范围
  -> getBusinessMetrics 选择角色允许的指标定义
  -> DB 按稳定事实和发生时范围聚合
  -> API 组装版本、成熟度、比较和隐私投影
  -> Web 只格式化卡片、趋势、表格与口径说明
```

DB repository 使用明确输入类型并返回整数计数/金额分/ISO bucket，不返回原始联系方式或自由文本。指标 service 对主范围和对比范围调用同一定义，禁止两个分支维护平行 SQL。下钻输入使用指标类型、范围和受控 cursor；服务端重新执行同一 scope，不把汇总响应当授权缓存。

Web 新增 `/analytics` 经营分析入口，与 `/dashboard` 今日工作台分离。页面按权限呈现招生、到课、消课、续费区块，复用现有查询、错误提示、金额和上海时间格式。趋势首期使用轻量、可访问的现有 CSS/SVG 组合，不新增图表库；同时显示文本值、分子/分母、对比、成熟度和数据质量说明。移动端改为单列并允许筛选器换行，不依赖横向滚动完成核心判断。

## 8. 迁移、兼容、发布与回滚

迁移只新增 nullable 字段、带默认值的周期号、事实表、FK、CHECK、唯一约束和实际查询索引。生成 Drizzle migration 后检查锁表、默认值和外键删除行为；不更改旧 dashboard/API 字段。

发布分四步：

1. 应用 additive migration；经营分析入口保持隐藏。
2. 发布兼容 writer，在同一事务双写线索、报名、续费、课消和生命周期相关事实；对明确可证明的旧事实仅以 `provenance=migrated` 迁移。
3. 对固定 fixture 和真实机构执行 shadow read，核对金值、覆盖缺口、慢查询与权限范围。
4. 开放 `/analytics`，再允许 T6/T7 调用 definitionVersion 1。

回滚只关闭 reader、路由和 UI，保留 schema 与 writer。生产回滚版本必须继续写稳定事实，不能退回完全无双写的旧应用。事实写入失败时与原领域事务一并回滚，避免业务成功但分析永久断层。

## 9. 风险与控制

- 历史漂移：所有销售事实使用结案时归属/校区快照，教学使用课次和生命周期发生时事实。
- 重复里程碑或机会：事务锁、cycle/sequence 和唯一约束共同控制，重放不新增事实。
- 指标定义漂移：单一 registry、definitionVersion 和金值 fixture 约束 Web/T6/T7。
- 权限泄露：scope 由服务端当前成员关系解析，顾问/教师只返回本人投影，小样本基准 fail closed。
- 大范围查询：最长两年、自动粒度、按 organization/campus/time/owner/teacher 的实际路径建索引；上线前用解释计划检查，不预先引入预聚合。
- 旧数据误导：缺失事实返回 coverage 计数和 notApplicable，不用当前 owner、余额或校区猜测历史。

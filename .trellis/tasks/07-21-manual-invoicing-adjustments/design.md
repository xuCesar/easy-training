# 技术设计：通用手工开单与账单调整

## 1. 设计边界与核心不变量

- 继续使用既有 `invoice` 作为统一应收投影，手工账单直接复用现有列表、详情、欠费、Dashboard 和收款流水，不建立第二套应收模型。
- 账单来源与业务活动类型分离：来源表达事实由报名、续费还是手工动作产生；业务活动类型表达课程报名、课程续费、材料费、考试费、补差价或其他。两者均通过领域枚举和集中映射扩展，UI 不以散落字符串推断业务规则。
- 手工账单必须关联学员，可选关联同一学员的在读或冻结报名；报名关联只用于追溯，不改变报名课程金额、已收或课时。
- `payment`、`refund` 和既有账单历史保持不可变。未收款时可改金额/日期/摘要；部分收款后仅可改日期/摘要；已结清或退款后全部冻结。
- 手工开单、账单调整、幂等事实和机构审计在同一 PostgreSQL transaction 内完成。写入点重新读取成员角色和校区范围，不信任客户端或 middleware 的旧授权快照。

## 2. 数据模型与迁移

### 2.1 账单当前投影

扩展 `invoice`：

- `source`：`enrollment | renewal | manual`，为历史/低层测试写入保留 enrollment 安全默认，但所有正式业务入口必须显式赋值。
- `businessActivityType`：首版包含 `course_enrollment | course_renewal | material_fee | exam_fee | price_difference | other`，为历史写入保留 course_enrollment 安全默认；后续可只扩展枚举与标签映射。
- `summary`：非空业务摘要；迁移保留“课程报名费用”兼容默认，手工创建必须显式填写且限制 200 字。
- `createdByUserId`：可空操作者外键，删除用户时保留账单。
- `createdByName`：可空操作者名称快照，使成员改名或移除后仍可追溯。
- `version`：非空正整数，默认 1，仅表示账单条款投影版本；每次有效调整递增，收款状态更新不依赖它表达资金版本。

迁移兼容策略：

1. 先以可回填方式新增字段；历史账单默认来源为报名、类型为课程报名、摘要为“课程报名费用”、版本为 1。
2. 通过 `enrollment_renewal.invoice_id` 将可识别的历史续费账单回填为续费来源、课程续费类型与摘要。
3. 历史创建人无法可靠恢复时保持 null，API 明确显示“历史数据”，不伪造操作者。
4. 回填完成后将来源、活动类型、摘要和版本设为非空；不新增可能被零价历史账单阻断的全局金额 check。
5. 同步修改报名转换、独立报名和续费三个自动开单写入点，显式写入来源、活动类型、摘要与操作者快照。

### 2.2 手工开单幂等事实

新增 `manual_invoice_creation` 追加式表：

- `organizationId`、`requestId` 和 `inputHash`。
- `invoiceId`、`studentId`、可空 `enrollmentId`、`campusId`。
- `operatorUserId`、`operatorName`、`createdAt`。
- `(organizationId, requestId)` 唯一索引，以及机构/账单查询索引。

该表保存完整请求指纹和稳定结果，使相同载荷可安全重放，不同载荷冲突，并让并发重复提交只产生一张账单。

### 2.3 账单调整事实

新增 `invoice_adjustment` 不可变表：

- 归属与关联：`organizationId`、`invoiceId`、`campusId`。
- 幂等：`requestId`、`inputHash`，机构内 requestId 唯一。
- 版本：`beforeVersion`、`afterVersion`。
- 完整条款快照：调整前后金额、到期日、摘要。
- 追溯：必填原因（最多 500 字）、操作人 ID/名称、创建时间。

完整前后值保存在领域调整事实中，详情按创建时间倒序读取。机构审计只保存白名单金额/日期、`summaryChanged`、调整流水 ID、版本和 requestId，不复制自由文本原因或摘要，避免中央审计 JSON 扩散业务文本。

新增审计 action：`manual_invoice_created`、`invoice_adjusted`，同步 Drizzle enum、migration、API action schema、审计页筛选与项目审计规范。

## 3. API 契约

在 `training.finance.invoices` 下扩展：

- `manualOptions({ query?, cursor? })`：返回当前财务成员可访问校区内的学员，以及每名学员可关联的在读/冻结报名；专用于开单，不扩大 finance 角色对学员管理接口的访问权限。
- `createManual(input)`：学员、可空报名、业务活动类型、摘要、金额、到期日和 requestId；来源固定由服务端写为 manual，活动类型只接受材料费、考试费、补差价和其他四个手工子集值。
- `adjust(input)`：账单 ID、可选新金额/到期日/摘要、必填原因、`expectedVersion` 和 requestId；至少一个字段发生实际变化。
- 既有 `list/detail` 增加来源、活动类型、摘要、报名/课程信息、创建人、创建时间、版本和服务端计算的调整能力。

详情返回：

- `canAdjustAmount`、`canAdjustDueDate`、`canAdjustSummary`，前端只用于呈现，服务端提交时仍重新验证。
- 调整历史及完整前后值、原因、操作人和时间。
- 手工账单课程信息可空，但摘要和来源始终明确。

列表搜索扩展到学员、课程和摘要；金额继续使用整数分，日期使用上海自然日，时间输出 ISO 带时区字符串。

## 4. 手工开单事务

1. 获取机构级 transaction advisory lock，锁定并重读当前成员；仅允许 owner/admin/campus_manager/finance，并重新计算最新校区范围。
2. 规范化输入并生成稳定 SHA-256 指纹。检查相同 requestId：当前操作者仍有资源权限且指纹一致时返回原结果；指纹不同时返回 `IDEMPOTENCY_CONFLICT`。
3. 锁定学员及其校区，校验机构归属、最新校区范围和校区启用状态。学员业务状态不作为历史收费阻断条件。
4. 如指定报名，锁定并校验同机构、同学员，状态只能为 active/frozen；transferred、跨学员或跨机构均拒绝。
5. 创建 manual 来源账单与 `manual_invoice_creation`，金额必须为 1–100,000,000 分，摘要 1–200 字，到期日为有效自然日。
6. 同 transaction 写 `manual_invoice_created` 审计，审计实体使用 creation UUID，校区来自学员事实。
7. 唯一约束竞争后重新读取首次提交结果；相同指纹返回 replay，不同指纹返回冲突。任何失败整体回滚。

## 5. 账单调整事务与并发

1. 与创建相同地事务内重读成员角色、校区范围和校区启用状态，再处理幂等重放。
2. `FOR UPDATE` 锁定目标 invoice，并通过同机构 student 校验最新校区范围；调整和收款沿用同一 invoice 行锁，形成确定顺序。
3. 先比较已存在 adjustment 的请求指纹；一致时返回原调整结果，不受账单后续版本变化影响，不新增版本或审计。
4. 非重放请求必须满足 `expectedVersion === invoice.version`，否则返回版本冲突并保留现状。
5. 状态规则使用存储状态、`paidAmountInCents` 和不可变资金流水共同判断：
   - refunded、显式 paid 或实收已覆盖应收：全部字段禁止调整。
   - 有任意实收但未结清：金额实际变化禁止，日期和摘要允许。
   - 无实收：金额、日期和摘要允许。
6. 归一化后没有实际变化则返回 `NO_ADJUSTMENT_CHANGES`。有效变更写 adjustment 完整前后值，并以 `WHERE version = expectedVersion` 更新账单条款和 `version + 1`。
7. 同 transaction 写 `invoice_adjusted` 审计。调整表、账单版本和审计任一失败均整体回滚。

并发结果：

- 调整先获得锁：收款随后按新金额检查是否超收。
- 收款先获得锁：金额调整看到实收后被拒绝；日期/摘要仍按部分收款规则执行。
- 两次不同调整读取同一版本：只有一个能递增版本，另一个返回版本冲突。
- 相同 requestId 并发：唯一约束最终只保留一个 adjustment 和一条审计。

## 6. 报名金额隔离与聚合兼容

- 机构总应收、欠费和 Dashboard 继续聚合所有非退款 invoice，因此手工账单自然进入财务闭环。
- 报名 `paidAmountInCents` 的重算只聚合 `source in (enrollment, renewal)` 的账单；手工账单即使带 enrollmentId 也不参与。
- 同步检查收款、退款及任何重新计算报名已收的 repository，统一使用来源过滤，避免不同入口产生漂移。
- 学员时间线继续展示手工账单，但使用摘要和来源，不显示“未命名课程/课程待确认”。
- 历史来源回填后，既有报名与续费账单保持原有聚合语义。

## 7. Web 交互

### 手工开单

- 财务工作台标题右侧增加“手工开单”主按钮，使用现有 Dialog、Field、Select、Toast 和 TanStack Query 模式。
- 表单包含学员必选、报名可选、活动类型、摘要、金额和到期日；操作者与创建时间由服务端生成。
- 学员选择支持延迟搜索、分页、加载、无数据、失败重试；选择学员后只展示其 active/frozen 报名，切换学员立即清空旧报名。
- 创建成功后关闭弹窗、刷新财务/欠费/Dashboard/学员时间线查询，并直接打开新账单详情；刷新失败不能把已成功创建误报为失败。

### 列表、详情与调整

- 桌面列表第一列展示“学员 / 摘要”，附来源或活动类型 Badge；移动卡片优先展示学员、摘要、未收和状态。
- 详情 Sheet 增加来源、活动类型、摘要、关联课程、创建人/时间和调整历史。
- 允许调整时显示“调整账单”；Dialog 预填当前条款、原因必填。部分收款时金额只读并说明原因；结清或退款时入口不可用并展示冻结状态。
- 版本冲突保留输入并提示加载最新账单；提交中禁止重复提交和关闭；失败保留表单，成功刷新列表、详情、欠费和 Dashboard。
- 调整历史独立处理加载失败，不阻断现有收款表单。

响应式和可访问性：Dialog 在 390px 单列可滚动，按钮移动端全宽；字段错误使用 `aria-invalid`/FieldError，键盘和焦点行为沿用系统组件，状态不只依赖颜色。

## 8. 错误语义、兼容与回滚

- NOT_FOUND：账单、学员或报名在当前机构/范围内不可见。
- FORBIDDEN：成员撤销、角色不允许或最新校区范围越权。
- BAD_REQUEST：非法金额/日期/摘要/原因、报名与学员不匹配、没有实际变化。
- CONFLICT：校区停用、报名状态不允许、账单状态冻结、金额已冻结、版本陈旧或幂等载荷冲突。
- INTERNAL_SERVER_ERROR：未识别数据库错误，响应不泄露约束名或内部 SQL。

迁移只新增枚举、列、表和索引并回填历史数据，不删除或改写 payment/refund。应用回滚时旧版本可忽略新增表和字段；已产生的新账单和调整事实不得因代码回滚被删除。实现不新增第三方依赖。

## 9. 影响文件

- DB：`packages/db/src/schema/training.ts`、migration/meta、`packages/db/src/repositories/finance.ts`、相关自动开单及报名已收聚合 repository、`packages/db/tests/finance.integration.ts`。
- API：`packages/api/src/contracts/training.ts`、`packages/api/src/repositories/finance.ts`、`packages/api/src/routers/index.ts`、审计 action 映射。
- Web：`apps/web/src/features/training/finance-workspace.tsx`，新增手工开单与账单调整 Dialog，审计页标签、Dashboard/时间线通用账单文案。
- 规范：`.trellis/spec/db/backend/finance-adjustments.md`、`.trellis/spec/db/backend/audit.md`。

# 技术设计：独立报名入口与原子建档开单

## 1. 边界与复用

- Web 在学员中心新增独立报名弹窗；线索转化弹窗保持现有入口和返回结构不变。
- API 新增 `training.enrollments.independentOptions` 与 `training.enrollments.createIndependent`，使用 `studentProcedure` 的现有角色边界；不把 `leadId` 塞入线索转化契约。
- DB 新增独立报名 repository，并抽取报名创建所需的课程、校区、班级容量和审计 helper；线索转化复用同一套有效报名校验，避免两条入口规则漂移。
- 事务内重新读取成员权限、学员、课程、班级和教室容量；客户端选项只用于展示，不能作为提交依据。

## 2. 数据模型与迁移

新增 `enrollment_registration` 追加式表，作为独立报名动作的幂等与结果记录：

- `organizationId`、`requestId`：机构内唯一约束。
- `inputHash`：固定字段顺序的 SHA-256 请求指纹，用于拒绝同一请求标识的不同载荷。
- `studentId`、`enrollmentId`、`invoiceId`、`classGroupId`、`campusId`、`operatorUserId` 和创建时间：保存结果与审计关联。

新增 `organization_audit_action = enrollment_created`。审计实体使用 `enrollment_registration`，after 快照只包含标识、课程/班级、课时、金额、到期日、来源 `independent` 和 requestId，不记录完整联系人手机号。

迁移只新增表、索引和 enum 值，不修改既有 `enrollment` 行，不为 `enrollment` 增加非空字段，也不创建可能因历史重复报名而失败的全局唯一索引。

## 3. API 契约

`independentOptions` 返回：

- 当前成员可访问的启用校区。
- 机构内启用课程及标准课时/价格。
- 可报名班级的课程、校区、容量、现有人数、剩余名额和排课摘要。
- `canOverridePackageTerms` 权限标识。

已有学员使用现有 `students.list` 的搜索/分页契约，避免选项接口一次返回全量学员。

`createIndependent` 输入：

- `requestId`。
- `student` 判别联合：已有 `studentId`，或新建的姓名、校区和一位主要联系人（姓名、手机号、关系）。新建学员状态固定为 `active`，标签/出生日期后补。
- `courseId`、可空 `classGroupId`、`purchasedLessons`、`amountInCents`、`invoiceDueDate`。

结果返回 `studentId`、`enrollmentId`、`invoiceId`、可空 `classGroupId` 和 `replayed`。

## 4. 事务流程

1. 在事务内先重新锁定并读取当前成员的机构/校区授权，再计算输入指纹并查询 `enrollment_registration`；相同指纹只有在当前操作者仍有权限时才返回既有结果，不同指纹返回幂等冲突。
2. 锁已有学员或新建学员所属校区；暂停/已结业学员直接拒绝。
3. 锁课程、目标班级及未来 scheduled 课次/已关联教室，校验启用状态、课程/校区匹配、班级状态、班级容量、已知教室容量、冲突和重复入班；历史自由文本教室没有容量事实时保持 #24 的兼容行为，不强行回填或误阻断。
4. 按稳定的机构 + 学员 + 课程锁键检查有效报名；若已存在，返回“请使用续费”。新建学员默认 active。
5. 创建报名（`leadId = null`）和待收/零价已结清账单；写入 `enrollment_registration` 与不可变组织审计。
6. 任一步失败整体回滚。并发相同 requestId 由唯一约束协调；唯一冲突后重新读取已提交的 registration 并返回 replayed 结果。

线索转化也复用第 4 步，保持“同课程有效报名使用续费”的全局入口一致；不改变线索状态和已有 leadActivity 语义。

## 5. Web 交互

- 学员中心操作区增加“办理报名”，打开独立报名弹窗。
- 首步切换“已有学员/新建学员”；已有学员使用带搜索的分页选择，新建学员显示最小资料和主要联系人字段。
- 课程、校区、班级按依赖过滤；暂不分班是明确选项；标准套餐只读时显示标准值，允许改价时开放输入。
- 提交期间禁用关闭和重复提交；冲突错误保留输入，成功 toast 后刷新学生列表、财务账单和班级数据，并提供收款入口。
- 覆盖加载、空数据、请求错误、字段错误、移动端滚动和 390px 宽度布局。

## 6. 兼容与回滚

- 旧线索报名接口、历史 enrollment/invoice 和学生档案保持兼容；`leadId` 为空仅表示独立来源。
- 迁移可通过删除新增表/索引和反向 enum 迁移回滚；业务回滚时保留已创建报名事实，不删除财务或教学历史。
- 不引入新依赖；复用现有 oRPC、Drizzle、TanStack Query、shadcn/ui 和 Toast 模式。

## 7. 关键风险

- 报名创建逻辑抽取可能影响线索转化，必须先补共享 helper 的回归测试再切换调用方。
- 既有测试/历史数据存在同学员同课程多条活动报名，不能直接添加全局唯一索引；需覆盖并发锁行为并为后续 #26 留出数据治理入口。
- 未来课次教室容量读取涉及多表锁，必须与现有入班/调班锁顺序一致，避免死锁；错误响应应保留受影响课次结构化数据。

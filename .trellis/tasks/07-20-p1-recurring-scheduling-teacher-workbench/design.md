# P1 技术设计：周期排课、未来课次调整与教师工作台

## 1. Architecture And Ownership

保持现有分层，不新增依赖：

- `packages/db`：排课规则、课次来源、批次幂等、教师绑定、点名草稿和最终结课的唯一业务实现。
- `packages/api`：Zod 输入输出、角色过程、错误映射和调用编排；不承载 SQL 或重复排课算法。
- `apps/web`：教务规则/批量调整界面与教师个人工作台，通过 oRPC 消费共享契约。
- `apps/server`：只保持现有 Hono、认证和 oRPC 装配；新增接口不绕开既有请求大小、Origin 和会话边界。

三类排程写入共享同一组服务端领域函数：候选时间展开、课程时长派生、资源冲突检查、未来课次判定、教师校区校验和原子提交。单节创建继续复用同一冲突检查，避免形成周期、批量和单节三套规则。

## 2. Data Model

### 2.1 `lesson_schedule_rule`

新增追加式规则表：

- `id`、`organizationId`、`classGroupId`
- `kind`：首期仅 `weekly`，作为判别字段保留扩展入口
- `intervalWeeks`：首期固定为 `1`，为隔周扩展保留
- `weekdays`：ISO 星期集合（1-7）
- `startMinuteOfDay`：上海时区当天开始分钟，避免跨层传递模糊时间字符串
- `room`、`timezone`（首期固定 `Asia/Shanghai`）
- `validFrom`、`validUntil`
- `revision`：规则每次修改递增
- `isActive`、`createdByUserId`、`updatedByUserId`、时间戳

同一班级可有多条规则。规则不物理删除；停用保留历史和课次来源。未来节假日/调休通过独立例外表扩展，不改写 `lesson` 事实。

### 2.2 `lesson` 增量字段

- `scheduleRuleId nullable`：手工单节课保持 `null`
- `scheduleRuleRevision nullable`
- `scheduleOccurrenceDate nullable`：规则中的逻辑发生日；即使预览把实际课次调整到其他日期，也保留原发生日
- `isScheduleOverride boolean default false`：人工调整后的规则例外
- `version integer default 1`：未来课次调整的乐观并发版本
- `teachingSummary nullable`
- `completedAt nullable`、`completedByUserId nullable`

规则课次使用 `(scheduleRuleId, scheduleOccurrenceDate)` 唯一约束，阻止重复生成。已取消的规则课次仍占用逻辑发生日，不能被静默重新生成；需要补课时走后续显式流程。

### 2.3 `lesson_schedule_batch`

新增批次幂等记录：

- `id`、`organizationId`、`requestId`
- `kind`：`generate`、`rule_sync`、`bulk_reschedule`、`rule_cancel_future`
- `scheduleRuleId nullable`、`actorUserId`
- `requestFingerprint`：规范化业务载荷哈希
- `affectedLessonIds`、`createdAt`

`(organizationId, requestId)` 唯一。相同 requestId 与相同指纹返回既有结果；不同指纹返回幂等冲突。批次行与领域更新在同一事务提交。

### 2.4 教师绑定与考勤草稿

- 为 `teacher(organizationId, userId)` 增加唯一索引；PostgreSQL 允许多个 `NULL`，未绑定教师档案保持兼容。
- `attendance` 继续作为每课次/学员的考勤行，在 `lesson.status = scheduled` 时表示可修改草稿；增加 `recordedByUserId`、`updatedAt` 以支持责任追踪。
- 保存草稿不写 `lessonConsumption`。最终结课在锁定当前 active 名单后同步最终 attendance、删除失效草稿、写课消、教学小结、完成时间/人员和审计。

## 3. Recurrence And Preview Model

### 3.1 Candidate Expansion

服务端根据规则、请求日期范围和 `Asia/Shanghai` 生成稳定候选：

1. 将 `validFrom/validUntil` 与请求范围求交集。
2. 按 ISO 星期展开逻辑发生日。
3. 由 `startMinuteOfDay` 得到 `startsAt`，由课程标准时长派生 `endsAt`。
4. 使用 `scheduleOccurrenceDate` 作为稳定候选键。
5. 查询已存在逻辑发生日、教师冲突和同校区规范化教室冲突。

首期设置服务端批次上限，防止超大预览或请求；具体上限作为契约常量由 API 和 DB 共用，不由前端自行定义。

### 3.2 Editable Preview

预览输出每个候选的基线、当前覆盖值、冲突类型和关联资源。客户端只可覆盖日期/开始时间和教室。提交时传入规则 revision、稳定候选键和最终候选；服务端重新展开基线，拒绝新增、遗漏、重复或越界候选，并再次执行完整冲突校验。

预览不是授权凭证，也不锁资源。提交事务必须重新读取规则、班级、课程、教师、校区和既有课次。

### 3.3 Rule Update And Exceptions

规则修改需要 `expectedRevision` 和生效日期。预览关联的未来 `scheduled` 课次：

- `isScheduleOverride = false`：默认套用新规则。
- `isScheduleOverride = true`：标记例外，由请求显式选择保留或重套。
- `completed/cancelled` 或 `startsAt <= transactionNow`：只读，不进入更新集合。

成功同步后更新规则 revision；重套规则的课次写入新 revision 并清除 override，保留例外的课次继续标记 override。

### 3.4 Rule Deactivation

停用预览返回该规则关联、查询时仍为 `scheduled` 且 `startsAt > now` 的未来课次数量和清单：

- 无未来课次：允许直接停用。
- 有未来课次且 `cancelFuture = false`：仅停用规则。
- 有未来课次且 `cancelFuture = true`：要求非空的统一取消原因；事务内重新锁定并校验所有目标仍为未来 `scheduled`，然后将原因写入每节目标课次并批量写 `cancelled` 字段。

事务先以 `transactionNow` 重新计算目标集合，再停用规则并执行所选分支；规则停用后，生成和规则同步入口必须拒绝该规则，不得因提交生成请求而隐式启用。

原因只保存在课次取消字段，不进入审计快照。

## 4. Arbitrary Future Lesson Changes

### 4.1 Preview Contract

教务选择有权限的课次 ID，服务端返回当前 `version`、原值和可选教师。批量编辑器支持：

- 教师、教室批量赋值
- 时间统一偏移（分钟或天）
- 每行覆盖日期/开始时间、教师和教室

最终候选始终携带显式 `startsAt`、派生 `endsAt`、`teacherId`、`room` 和 `expectedVersion`；不存在“全部设置同一绝对时间”的 API。

### 4.2 Atomic Apply

在机构 advisory lock 和单个数据库事务中：

1. 重新读取当前成员角色/校区范围。
2. 按稳定顺序锁定全部课次；每条必须 `scheduled`、`startsAt > transactionNow`、版本匹配且校区可写。
3. 校验目标教师同机构且归属课次校区，课程仍启用，时长由课程标准值派生。
4. 对未选中既有课次及批次内部候选执行同一套半开区间冲突检查。
5. 全部通过后更新课次、递增 version；规则来源课次设置 `isScheduleOverride = true`。
6. 写批次幂等记录和每课次审计；任一失败整批回滚。

## 5. Teacher Binding And Authorization

教师档案创建/更新契约增加 `userId: string | null`。绑定写入只允许 `owner/admin`，并在机构锁内验证：

- 当前成员仍为管理角色。
- 目标 user 是同机构当前 `teacher` 成员。
- 目标 user 未绑定其他教师档案。
- 解绑不会修改教师历史课次。

成员角色从 `teacher` 改为其他角色或移除成员时，如果仍有教师绑定，返回明确冲突并要求先解绑，避免无效悬挂关系。

不扩大现有 `academicManagementProcedure`。新增教师工作台读取过程允许当前 `teacher` 角色，但 DB repository 必须同时匹配 `teacher.userId = session.user.id` 和目标 `lesson.teacherId`；管理角色继续使用既有校区范围过程。

## 6. Attendance Draft And Completion

### 6.1 Draft

- 草稿开放条件：课次为 `scheduled`，当前时间不早于 `startsAt - 30 minutes`，操作者是绑定教师本人或有权教务管理者。
- 保存时锁定班级并读取当前 active 报名全集；输入必须完整匹配当前名单。
- 对当前名单 upsert attendance，删除该课次中已不属于当前 active 名单的草稿行；不写课消、不改 lesson 状态。

### 6.2 Fast Completion

- `now >= endsAt` 才允许结课。
- 没有草稿时，“全勤并结课”由服务端以当前 active 名单构造全员 `present`；客户端仍展示人数与预计扣减后确认。
- 有草稿时沿用草稿；若当前 active 名单与草稿不一致，返回名单变化冲突，要求刷新确认。
- 最终事务保持现有锁顺序：机构 → 班级 → active 报名 → 课次相关行；预检所有余额后才写入。
- 成功后写最终 attendance、`lessonConsumption`、余额、teachingSummary、completedAt/completedBy、`completed` 状态和 `lesson_completed` 审计。完成后所有教学事实不可修改。

## 7. API Surface

在现有 `training.teaching` 下扩展：

- `scheduleRules.list/create/previewGenerate/generate/previewUpdate/update/previewDeactivate/deactivate`
- `lessons.previewBulkUpdate/bulkUpdate`
- `teachers.create/update` 增加可空绑定成员，并提供同机构可绑定教师成员候选
- `teacherWorkspace.lessons/attendance/saveDraft/complete`

所有输入输出由 Zod 定义并导出推导类型。预览和提交共享候选 schema；提交额外要求 `requestId`、revision/version 和最终候选。错误区分参数、权限、状态/版本冲突、资源冲突、名单变化和幂等冲突。

## 8. Web Information Architecture

- 教务工作区保留课程、教师、班级和课次入口；在班级/课次上下文增加周期规则、生成预览和多选批量调整。
- 将新增排课规则编辑器、候选预览表、批量调整器拆出独立 feature 组件，避免继续膨胀 `academic-workspace.tsx`。
- 新增教师个人工作台路由，只展示本人课次；提供待点名、待结课、未来课表和近期历史状态。
- 点名 UI 默认全勤，异常项按需修改；计划结束后提供“全勤并结课”快捷动作，草稿场景显示最后保存状态和名单变化错误。
- 桌面端使用表格/侧栏预览，移动端使用分组卡片和底部固定提交区；覆盖加载、空、错误、冲突刷新和提交中状态。

## 9. Audit And Observability

扩展审计 action，至少覆盖规则创建/修改/停用、批量生成、课次调整、批量取消和教师绑定变化。高风险课次变更与审计同事务：

- 规则/批次事件记录规则或批次 ID、数量、日期范围和 requestId。
- 每课次调整记录开始/结束、教师、教室、状态和 version 的白名单前后值。
- 不记录取消原因、教学小结、学员名单或考勤备注。

领域冲突保持可预期业务错误；数据库、事务或审计异常沿用结构化日志与 requestId，不记录请求自由文本。

## 10. Migration, Compatibility And Rollback

- migration 只新增表、索引、可空字段和带默认值字段；旧课次保持 `scheduleRuleId = null`，现有手工排课、取消和结课可继续工作。
- 部署顺序为 migration 先行，再发布兼容代码。应用回滚后新表/字段不影响旧代码；生产环境不得通过删除新表回滚已产生规则、草稿、批次或审计事实。
- 新代码上线后，`scheduleText` 从规则/未来课次派生展示，但不用于写入或冲突判断。
- 若新路径出现问题，可停止使用新 UI/API，保留既有单节创建和管理者结课路径；已生成/调整的 lesson 仍是普通可读取课次。

## 11. Key Risks And Mitigations

- 预览后资源变化：提交时完整重检并用版本/机构锁防止陈旧写入。
- 批次内部互相冲突：候选集合内部和外部统一检测，不能只查数据库旧行。
- 规则修改误改历史：DB 写条件同时限制 status、时间和 expected version， completed/cancelled 永不进入集合。
- 草稿名单陈旧：最终结课锁定当前 active 名单并要求刷新，不按旧草稿扣课。
- 教师权限扩大：教师过程只作为入口，repository 仍按 teacher.userId 和 lesson.teacherId 做资源级授权。
- 大批量请求：共享契约上限、规范化载荷指纹和原子批次，避免无限数组与重复提交。

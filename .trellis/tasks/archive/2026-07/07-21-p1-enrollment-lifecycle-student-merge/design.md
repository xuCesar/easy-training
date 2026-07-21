# 技术设计：报名生命周期与学员联系人查重合并

## 1. 边界与状态模型

- `student` 是学员档案，不自动跟随任何单条报名的冻结、复课、退班或转班变化。保留现有 `graduated` 枚举值仅作历史兼容和人工标记，本任务不新增结业命令。
- `enrollment` 是单课程权益和教学资格：在保留 `active / transferred` 的基础上增加 `frozen`。退班不改变报名状态，只将当前班级归属置空；复课从 `frozen` 回到 `active`；转班仍为 `active`，但更换同课程、同校区的班级。
- 所有影响教学资格的动作写入追加式 `enrollment_lifecycle_event`：保存动作、操作前后状态/班级、生效时点、原因、操作者、requestId 与输入哈希。它既是审计事实，也是判定某个课次开始时报名是否可参加的历史依据。
- 课程间相互独立：一条报名冻结不会影响同一学员的其他报名。现有跨课程 `enrollmentTransfer` 继续保持其财务语义，不与同课程转班混用。

## 2. 未来课次与历史事实

1. 操作在事务内以当前时间作为 `effectiveAt`，锁定报名、源/目标班级、相关未来课次及容量资源。
2. 点名成员加载统一为“课次开始时的报名状态与班级归属”：
   - 冻结至复课之间开始的课次排除；复课后的课次重新纳入。
   - 转班前开始的课次仍按源班级解释，转班后开始的课次只属于目标班级。
   - 退班后开始的课次不再纳入；重新分班后仅纳入重新分班之后开始的课次。
   - 补课成员也需按目标课次开始时的报名状态过滤。
3. 已完成课次不重新计算成员，不更新 `attendance`、`lessonConsumption`、账单、收款或审计。操作发生时已开始但尚未完成的课次按其开始时的历史状态处理。

## 3. 数据与迁移

- `enrollment`：增加 `version`，并将 `enrollment_status` 扩展为 `frozen`；既有记录使用 `version = 1`。
- `enrollment_lifecycle_event`：
  - `organizationId`、`enrollmentId`、`kind`（`frozen` / `resumed` / `class_transferred` / `class_withdrawn` / `class_assigned`）、`beforeStatus`、`afterStatus`、`fromClassGroupId`、`toClassGroupId`、`effectiveAt`、`reason`、`operatorUserId`、`requestId`、`inputHash`、`createdAt`。
  - 机构内 request ID 唯一；以历史事件顺序重放某一 `lesson.startsAt` 的成员资格。首次事件的 before 值是兼容旧报名的基线。
- 电话标准化：为 `student.guardianPhone` 与 `studentContact.phone` 增加可索引的标准化号码列；迁移回填现有数据。标准化仅去除常见格式字符，并把 `+86` / `86` 归一为国内号码，不把姓名或生日当作匹配条件。
- 学员合并：
  - `student.mergedIntoStudentId` 与 `mergedAt` 标记源档案；源档案所有写入命令统一拒绝。
  - `student_merge` 记录 source、target、操作者、requestId、输入哈希、字段选择和时间；source 在机构内至多合并一次，request ID 在机构内唯一。
  - 增加报名生命周期和学员合并审计 action；审计只保存标识、选择结果和计数，不保存完整电话或自由文本原因。
- 迁移仅新增列、表、索引与 enum 值；不删除、重写或合并历史业务事实。

## 4. 服务端契约与事务

- 新增 `training.enrollmentLifecycle.options`、`freeze`、`resume`、`transferClass`、`withdrawClass`、`assignClass`；输入均含 `enrollmentId`、`expectedVersion`、`requestId`，有业务说明时包含受限长度 `reason`。
- 新增 `training.students.duplicateCandidates`、`mergePreview`、`merge`：创建/编辑/独立报名也复用相同的查重查询。合并提交显式包含主档案、源档案、冲突字段选择和主联系人选择，并携带 `expectedVersion` / `requestId`。
- 写入时在 DB transaction 内重读成员、角色和校区范围。报名教学操作沿用教务写角色；合并只允许 owner/admin，且必须对两个校区都有写权限。
- 转班校验目标课程/校区、班级状态、班级容量、未来教室容量与补课冲突。所有动作重放相同 request ID 返回原结果；同 request ID 不同载荷返回幂等冲突。
- 合并前锁定源/主学员及业务关联。两个档案有同课程有效报名、同一历史课次会形成重复考勤、目标已存在等价联系人/主联系人无法解析等情况，返回结构化冲突，不做部分迁移。
- 可安全迁移的关联包括报名、账单、历史考勤、联系人与标签；收款、退款、课消继续通过其账单/报名外键自然可追溯。迁移后所有读取以主档案展示，审计和 `student_merge` 可反查源档案。

## 5. Web 交互

- 在班级报名/学员档案中提供报名动作菜单：冻结、复课、转班、退班与重新分班。危险动作使用系统通用确认弹窗，展示仅影响未来课次、剩余课时不变及受影响课次数量。
- 学员创建、编辑和独立报名的新建路径按手机号显示非阻断的疑似重复候选；候选列出脱敏手机号、姓名、校区和档案状态。
- 合并从学员详情的“更多操作”进入：先搜索并选择同机构候选，再显示预览、业务冲突、字段选择和最终确认。仅 owner/admin 看见入口。
- 成功后刷新学员、班级报名、课次点名、财务与审计查询；保留表单输入和明确展示业务冲突错误。

## 6. 兼容、风险与回滚

- 既有 `assignEnrollmentClass` 迁移到生命周期命令的同一领域校验，保留兼容入口或以适配层返回相同结果，避免现有班级页面回归。
- 历史报名没有生命周期事件：首次动作写入 before/after 基线，历史完成事实不依赖重新推导的成员名单。
- 合并最主要风险是关联迁移与唯一约束冲突；先实现 preview 和冲突矩阵，再开放提交。发生失败时整个事务回滚，源档案和关联都不变化。
- 回滚仅停用 API/UI 入口或回退新增表/列的使用，不删除已产生的生命周期/合并审计事实。

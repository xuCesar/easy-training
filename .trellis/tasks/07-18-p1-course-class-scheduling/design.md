# P1 技术设计：课程、班级与课次排程

## Architecture

沿用 `contracts -> API repository/router -> DB repository` 分层。新增教学领域 repository，复用学员模块的写入授权模式：router 传入服务端 `organizationId`、`userId` 和读取快照，DB 写事务在机构 advisory lock 内重新锁定成员并计算有效校区范围。

领域职责：

- `course`：机构级课程目录和启停；保留既有字段并追加 `isActive`，不改变报名金额/课包快照语义。
- `teacher` / `teacherCampus`：最小教师主数据与校区归属，供班级和课次校验。
- `classGroup`：单校区、单课程、单主讲教师的招生与教学容器。
- `lesson`：唯一排程事实源；`scheduleText` 仅为兼容摘要，不能反向驱动课次。

## Data And Migration

- 为 `course` 增加 `isActive`（默认 true）并为机构+启用状态补充读取索引；历史课程默认启用。
- 为 `lesson` 追加 `cancelledAt`、`cancelledByUserId`、`cancellationReason`，保留现有状态，不物理删除。
- 追加冲突查询索引，至少覆盖 `(organizationId, teacherId, startsAt)` 与 `(organizationId, campusId, room, startsAt)`；时间重叠仍在事务查询中判断。
- 保持 `classGroup.scheduleText` nullable/兼容语义不破坏既有报名页面；由课次列表生成的摘要只作为 UI 展示，不需要迁移回填。

## Write Rules

1. 课程和教师目录：owner/admin 在机构锁内重新验证管理权限；课程停用前不删除历史引用。
2. 班级：锁定校区、课程、教师与教师校区归属，要求同机构、课程启用、校区启用、容量正数；更新容量需统计已有报名。
3. 新建课次：锁定班级、班级校区、主讲教师；仅允许 `recruiting/running`，强制采用班级校区和教师；校验 `startsAt < endsAt` 与课程标准时长。
4. 冲突：对同机构的同教师及同校区同规范化教室，查询 `scheduled` 且 `existing.startsAt < next.endsAt AND existing.endsAt > next.startsAt` 的记录。写入与校验在同一事务，冲突/锁异常映射为可恢复 `CONFLICT`。
5. 取消：锁定课次，只有 `scheduled` 可以取消；写入审计字段与状态，不改写班级、报名、考勤、账单或课时。

## Authorization

- 课程、教师：owner/admin 写；campus_manager 可读取课程和教师候选项。
- 班级、课次：owner/admin 在机构范围写；campus_manager 在有效校区范围写。
- consultant 只通过既有转报名接口读取可报名候选，teacher/finance 不获得教务管理 API。
- 读取始终按机构和校区范围收窄；teacher 的课表读取作为后续独立接口，避免本期扩大个人信息暴露面。

## Compatibility

- 报名转化继续使用 `course` 和 `classGroup`，但候选读取需过滤停用课程，且继续仅返回 `recruiting/running`、同校区、未满班级。
- 课次、班级和课程变化统一失效 `training.snapshot`、班级列表与转报名候选缓存。
- 本期不产生 attendance 或课时扣减写入；后续能力只能以 lesson ID 为锚点。

## Rollback

迁移仅追加字段和索引。回滚应用后，既有转报名与运营工作台仍可读取旧字段；新增课次取消审计字段可被旧版本忽略。不得通过删除课程、班级或课次作为回滚手段。

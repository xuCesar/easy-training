# P0 教务状态边界

## Goal

在不改变既有课程、报名和课次数据模型的前提下，明确班级生命周期，并阻止转课或其他非有效报名重新入班、进入点名名单或消耗课时。

## Confirmed Facts

- `classGroup.status` 已有 `recruiting`、`running`、`paused`、`completed` 枚举，但 `updateClassGroupRecord` 可从任意状态直接改成任意状态；`createClassGroupRecord` 也接受任意初始状态。
- 现有课次创建和入班只允许 `recruiting/running` 班级；但 `completeLessonRecord` 未校验班级状态。
- `transferEnrollmentRecord` 已在同一事务把来源报名设为 `transferred`、清空剩余课时及 `classGroupId`；但 `assignEnrollmentClassRecord`、班级成员查询和结课名单仍未强制 `enrollment.status = active`，所以直接 repository/API 调用可重新把已转课报名入班。
- 班级状态为 `completed` 时，现有更新路径不检查是否仍存在 `scheduled` 课次。
- P0 CSV 请求契约已拆分到 `07-19-p0-csv-request-contract`，本子任务不再修改导入边界。

## Requirements

### R1：受控班级生命周期

- 新建班级固定为 `recruiting`。
- 班级状态迁移仅允许：`recruiting → running`、`running → paused | completed`、`paused → running | completed`；`completed` 不得回退或重新开启。
- 尝试将班级变为 `completed` 时，如仍有 `scheduled` 课次必须拒绝；操作者须先完成或取消全部待上课次。
- 状态校验在 `packages/db` 的同一事务内完成，API 与 UI 不得成为唯一防线。

### R2：有效报名才是班级成员

- 仅 `enrollment.status = active` 的报名可被分配/移出班级、计入班级容量、出现在成员管理与课次点名名单中。
- 已转课报名必须被拒绝重新入班，并且即使历史数据仍保留旧 `classGroupId`，也不得进入结课、考勤或课时扣减路径。
- 结课在锁定课次与班级后，只以 active 报名建立完整名单和消课流水。

### R3：兼容与错误语义

- 保留现有 oRPC endpoint、表结构和历史 `attendance`/`lessonConsumption` 记录；不新增 schema migration。
- 新领域错误映射为既有 `CONFLICT` 语义，前端显示针对状态或报名失效的可理解提示。
- 同步调整教务工作台：新建班级不提供任意初始状态选择；编辑态只展示当前状态可达的下一个状态，已完成班级不可重新激活。

## Acceptance Criteria

- [ ] DB repository、API 和 Web 均不能创建非 `recruiting` 初始班级，或绕过状态图执行非法迁移。
- [ ] 存在 `scheduled` 课次时，班级不能改为 `completed`；处理全部课次后可完成。
- [ ] 已转课报名通过 API 或直接 repository 入班均被拒绝；历史/并发残留的非 active 报名不参与成员、容量、点名或消课。
- [ ] 状态、报名和课次边界以 PostgreSQL 集成测试覆盖，包含跨机构/校区和重复/并发结课不回归。
- [ ] 受影响 API/前端提示保持 `CONFLICT` 语义；类型、Biome、相关集成测试和生产构建通过。

## Out of Scope

- P1 的转班、退班、冻结、复课、独立报名和班级级结业流程。
- 修改现有 `class_status` / `enrollment_status` 枚举，或为历史数据执行批量回填。

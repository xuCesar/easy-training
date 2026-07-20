# 当前教务边界调研

## 代码事实

- `packages/db/src/schema/training.ts` 已定义 `teacher.userId`、`classGroup`、`lesson`、`attendance` 和 `lessonConsumption`。`lesson` 目前没有周期规则来源、完成时间、教学小结或人工例外标记。
- `packages/db/src/repositories/teaching.ts` 的单节创建已在事务内重新校验成员和校区，并检查课程时长、教师归属及教师/教室重叠；`lesson` 是唯一排程事实。
- 同一 repository 的结课动作锁定班级和 active 报名全集，在一个事务内写考勤、课消、余额、`completed` 状态和 `lesson_completed` 审计。
- `packages/api/src/contracts/training.ts` 的教师写入契约没有 `userId`，课次契约只有列表、单节创建、取消、名单读取和一次性结课。
- `packages/api/src/routers/index.ts` 的课次过程全部使用教务管理过程，教师角色没有名单、草稿或结课入口。
- `apps/web/src/features/training/academic-workspace.tsx` 将课次创建、取消和“点名并结课”集中在一个大型工作区组件中；点名当前只有最终提交，没有草稿。
- `packages/db/src/repositories/training-dashboard.ts` 已按 `teacher.userId` 收窄教师的近期课次摘要，可复用该身份映射原则，但不能替代资源级写授权。

## 必须保持的项目规范

- `.trellis/spec/db/backend/teaching.md`：`course -> classGroup -> lesson` 为稳定主链，`lesson` 是唯一排程事实，时间区间为半开区间，最终结课必须锁定完整 active 名单并原子写入考勤、课消和审计。
- `.trellis/spec/db/backend/organization-management.md`：写事务在机构锁内重新读取当前成员角色和校区范围；API 中间件快照不能作为最终授权。
- `.trellis/spec/db/backend/audit.md`：高风险写入与审计使用同一事务；审计快照只保留白名单字段，不写自由文本备注。
- `.trellis/spec/guides/project-conventions.md` 与 `cross-layer-thinking-guide.md`：契约、API、数据库和 Web 必须同步，迁移保持追加兼容，不新增平行业务实现。

## 规划影响

- 周期规则需要独立持久化，并通过 `lesson` 的可空外键和规则版本保持实例追溯；手工单节课继续允许没有规则来源。
- 点名草稿可以复用 `attendance` 作为当前草稿行，但 `lesson.status = scheduled` 时不得产生 `lessonConsumption`；最终结课仍是唯一课消入口。
- 任意批量变更和规则同步必须共享一套服务端候选校验与冲突检测，避免单节、周期和批量三套规则漂移。
- 教师入口需要独立的资源级授权过程，不能把教师加入现有通用教务管理角色集合。

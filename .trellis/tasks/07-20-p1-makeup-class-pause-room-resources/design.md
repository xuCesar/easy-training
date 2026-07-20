# 技术设计：补课、班级停复课与教室资源

## 1. 边界与分层

- 数据事实继续由 `lesson`、`attendance` 和 `lessonConsumption` 承载；`classGroup.scheduleText` 只保留兼容摘要。
- 新增 `classroom` 资源实体，`lesson.roomId` 和规则 `roomId` 采用 nullable 兼容迁移，同时保留 `lesson.room` 文本快照，历史数据无需回填。
- 补课使用独立的 `lessonMakeup` 关联记录，关联来源 enrollment、来源 lesson、目标 lesson；首期目标是现有未来课次，不新增专用 lesson。
- 班级停复课使用独立命令和事件/幂等记录，不再通过普通班级编辑隐式改变状态。
- `packages/api` 负责契约和路由适配，`packages/db` repository 负责机构/校区重验、锁、事务、冲突、容量和审计；`apps/server` 不承载业务逻辑。

## 2. 数据流

### 补课

1. API 校验 `sourceLessonId/sourceEnrollmentId/targetLessonId/requestId`。
2. DB 事务按机构、来源课次、来源报名、目标课次的稳定顺序加锁。
3. 验证来源课次已完成、来源考勤为 `absent/leave`、报名 active、课程/校区一致，目标课次为未来 scheduled 且目标班级可处理。
4. 检查目标教室启用、教师/教室/时间冲突与容量（班级 active 人数 + 有效补课人数）。
5. 写入唯一有效补课关系和审计；重复 requestId 返回原结果。
6. 点名读取目标班级 active 报名并追加有效补课成员；结课按补课成员写考勤和唯一课消账本，来源事实不变。

### 班级停复课

1. 事务锁机构/成员、班级，再锁未来 scheduled 课次。
2. 停课校验 `running -> paused`、原因和处理策略；保留分支只更新班级，取消分支同事务取消尚未开始课次。
3. 周期规则保留，但所有创建、更新、生成、同步、调课命令统一拒绝 paused 班级。
4. 复课只执行 `paused -> running` 和审计，不恢复取消课次、不自动生成课次。
5. 点名、结课、调课在服务端拒绝 paused 班级；保留课次到期后通过查询标记异常。

### 教室

1. `classroom` 以 `(organizationId, campusId, normalizedName)` 唯一。
2. 新排课入口传资源 ID，服务端读取启用状态、校区归属、容量并写入 roomId + 文本快照。
3. 停用前锁定教室并查询未来 scheduled 引用；存在引用则返回影响列表并回滚。
4. 历史 roomId 为空的课次继续使用 room 文本；资源更名不改写 lesson 快照。

## 3. 关键兼容与并发约束

- 新迁移只增加 nullable 字段、实体和索引，不删除或改写现有 room 文本及状态值。
- 预览不持有资源锁；提交事务重新读取资源状态、班级状态、课次 version、报名和容量。
- 未来课次判断统一使用事务内 `now`：`status=scheduled && startsAt > now`。
- 幂等记录以机构与 requestId 唯一，并保存请求指纹；相同载荷重放返回原业务 ID，不新增审计。
- 所有新增审计 action 同步 Drizzle enum、API schema 和审计展示标签。
- 补课成员不能写入 `enrollment.classGroupId`，避免改变班级归属和目标班级容量语义。

## 4. 失败与回滚

- 任一权限、资源、容量、状态、冲突、唯一约束或审计写入失败，整笔事务回滚。
- 停课取消未来课次不得循环调用单课次 API，使用单事务批量更新，确保班级状态和课次状态一致。
- 教室停用失败只返回未来影响课次，不改变启用状态。
- 迁移可回滚方式为反向追加 migration；不执行历史 room 文本的破坏性回填。

# P0 教务状态边界：技术设计

## 状态与写入边界

```text
new → recruiting → running ↔ paused → completed
                      └──────────────→ completed
```

- 创建路径不接受调用方指定状态，仓储固定写入 `recruiting`。
- 更新路径继续复用 `updateClassGroupRecord` 的完整编辑输入，但从被行锁锁住的旧状态到请求状态必须匹配迁移表；`completed → completed` 可保留元数据编辑，任何离开 `completed` 的状态变更被拒绝。
- 进入 `completed` 前查询该机构、该班级的 `scheduled` 课次。查询和班级更新在同一事务且班级已锁定，防止并发排课绕过检查。

## 有效报名规则

`enrollment.status = active` 是班级当前成员的唯一事实。以下 repository 查询和写入必须显式过滤或校验它：

1. `assignEnrollmentClassRecord`：对目标班级赋值前拒绝非 active 报名；容量和重复检测仅计算 active。
2. `listClassEnrollmentRecords`：仅列 active 报名，防止前端把已转课报名作为候选人。
3. `getLessonAttendanceRecord` 与 `completeLessonRecord`：仅选择 active 报名；结课名单、考勤和 `lessonConsumption` 均以该集合为准。
4. `transferEnrollmentRecord` 继续原子清空来源 `classGroupId`；active 筛选同时保护历史遗留/并发异常数据。

## 错误与 UI

- 新增 repository 错误：非法状态迁移、存在待上课次、报名非 active；API 统一映射 `CONFLICT`。
- `ClassEditor` 在新建时固定 `recruiting`，编辑时只提供基于当前状态的可达选项；后端仍为最终裁决。
- 无需变更 oRPC 公开形状、数据库 schema 或迁移。

## 并发与回滚

- 延续 `getCurrentWriteCampusAccess` 的机构 advisory lock 及班级/报名行锁；状态检查、课次检查、报名名单和写入留在同一事务。
- 本任务只收紧允许写入集合，不删除数据；回滚应用版本可恢复旧行为，不需数据回滚。
- 若生产中存在已完成班级仍有待上课次，修复后仅会阻止下一次完成操作，操作者可取消或结课后重试。

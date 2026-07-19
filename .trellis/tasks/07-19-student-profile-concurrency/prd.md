# 防止学员档案并发编辑覆盖

## Goal

实现 #12：以详情版本标识保护学员档案及联系人、主要联系人和标签的并发更新，发生冲突时返回可恢复的 ORPC CONFLICT。

## Requirements

- 编辑学员档案时，前端必须提交详情接口返回的 `updatedAt` 版本标识。
- 更新联系人、主要联系人、标签及基础资料前，服务端必须在同一写事务中锁定学员记录并比较版本。
- 版本不一致时，接口返回 ORPC `CONFLICT`，且不得产生联系人、主要联系人、guardian 兼容字段或标签的任何部分写入。
- 前端遇到冲突时应提示用户先刷新最新资料；当前表单内容必须保留，不能静默覆盖或自动丢弃。
- 现有创建、读取、权限校验、主要联系人唯一性与 guardian 兼容回写行为保持不变。

## Acceptance Criteria

- [x] 更新请求契约包含并校验详情版本标识，详情与更新使用相同的稳定时间序列化格式。
- [x] 两个基于同一旧版本的更新中，先提交者成功，后提交者得到明确冲突且数据库状态保持为先提交者的完整结果。
- [x] 联系人新增、主要联系人切换、标签替换三类并发覆盖均有 PostgreSQL 集成测试覆盖。
- [x] API 将版本冲突映射为 ORPC `CONFLICT`；Web 保留未保存表单并提供刷新后重试的明确路径。
- [x] 类型检查、集成测试、规范检查与构建通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

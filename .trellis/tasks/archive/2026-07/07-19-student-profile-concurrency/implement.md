# 实施计划

- [x] 扩展更新契约和 DB repository 输入，加入 `expectedUpdatedAt` 与 `STUDENT_VERSION_CONFLICT`。
- [x] 在锁定学员行后、任何联系人和标签写入前进行版本比较，并以数据库表达式单调推进 `updatedAt`。
- [x] 将领域冲突映射为 ORPC `CONFLICT`，保留既有错误语义。
- [x] 更新编辑弹窗：提交详情版本、冲突后保留草稿，并允许刷新最新版本后手动重试。
- [x] 补 PostgreSQL 集成测试：并发联系人、主要联系人和标签更新，以及路由层 `CONFLICT`。
- [x] 运行 `pnpm db:migrate`、`pnpm check-types`、`pnpm test:integration`、`pnpm check`、`pnpm build`。
- [ ] 完成后更新任务验收、同步 GitHub #12，并按用户指令提交推送。

## 回滚

本任务没有迁移。回滚应用代码即可；不会改变已有学员、联系人或标签数据结构。

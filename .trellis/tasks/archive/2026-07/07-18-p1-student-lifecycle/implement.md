# P1 实施计划：学员档案、家长联系人与标签

## Execution Order

1. 扩展 Drizzle schema，新增联系人、标签与关联表，生成并审查追加式 migration 与历史联系人回填。
2. 新增 DB students repository：范围过滤、分页搜索、详情聚合、联系人与标签事务写入、标签字典管理。
3. 在转报名事务中新建主要联系人，并保持现有 guardian 字段的兼容回写。
4. 扩展 API 契约、授权过程、adapter 与 router，映射领域错误且禁止手机号泄露。
5. 新增 `/students` Web 路由、导航入口及学员维护界面；复用 oRPC、TanStack Query 和现有 UI 组件模式。
6. 补数据库集成测试及前端浏览器验收，执行质量门禁与安全审查。

## Validation

```bash
pnpm db:migrate
pnpm check-types
pnpm test:integration
pnpm check
pnpm build
```

前端完成后使用真实浏览器检查 `/students` 的列表、筛选、新建、编辑、权限与停用校区失败路径，覆盖桌面和移动端。

## Risks And Rollback

- 新联系人必须与既有 guardian 字段在同一事务内更新，避免线索转报名手机号匹配出现分叉。
- 主要联系人“至少一位且仅一位”由事务锁和数据库部分唯一索引共同保护；更新联系人集合不能先短暂清空主要联系人后提交。
- 禁止本期校区迁移，避免报名、账单与后续班级归属不一致。
- 所有范围与校区启用验证都要在写事务中重复执行，不能只依赖路由层权限。
- schema 为追加式，旧应用可继续读取现有 student guardian 字段；回滚应用不应删除新产生的领域数据。

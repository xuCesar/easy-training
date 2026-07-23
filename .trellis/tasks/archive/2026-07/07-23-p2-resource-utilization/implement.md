# P2 教师与班级资源利用分析实施计划

## Ordered Checklist

1. 在 schema 定义容量历史表、约束和查询索引，生成 additive migration。
2. 扩展教师和班级创建/更新事务及既有维护表单：建立首次容量版本，容量变更写入生效日期版本；相同日期更新保持幂等。
3. 在数据库 repository 实现教师利用率、班级席位/满班风险和课次上座率查询，复用现有成员、课次、报名和校区范围。
4. 扩展 Zod 分析契约、API 服务和 `training.analytics` 路由，落实角色与校区范围。
5. 在 PostgreSQL 集成测试覆盖容量历史、实际/计划分子、补课不重复、状态筛选、跨机构/校区与教师本人限制。
6. 运行迁移、集成测试、类型检查、Biome、构建和两年范围的 `EXPLAIN`；记录未配置与历史覆盖缺口行为。

## Validation

```bash
pnpm db:generate
pnpm db:migrate
pnpm test:integration
pnpm check-types
pnpm check
pnpm build
```

### 本地 mock 性能证据（2026-07-24）

- `packages/db/scripts/seed-resource-utilization-mock.sql` 使用独立机构生成 80 名教师、80 个班级、160 条容量版本和 58,400 条两年课次。
- 课次聚合 `EXPLAIN (ANALYZE, BUFFERS)`：全机构 45.5ms（覆盖绝大多数课次，顺序扫描合理）；单校区 10.8ms，命中现有 `lesson_campus_starts_idx`。
- 本轮未新增索引；后续生产量级验收仍需在上线前复测。

## Risk and Rollback

- 容量历史的生效日必须由服务端确定，避免客户端写入覆盖过去；同一日重试只能更新同一版本。
- 不能使用当前 `weeklyCapacityHours` 或 `capacity` 回填旧课次，避免伪造历史利用率。
- 指标查询保持只读；出现异常时关闭资源分析 reader，不影响教师、班级、排课和报名既有流程。

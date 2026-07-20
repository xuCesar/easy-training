# 实现计划：Issue #24

## 顺序清单

1. 扩展 schema、审计 action 和追加式 migration：教室、roomId、补课关联、班级停复课幂等/事件。
2. 扩展 API contracts 与错误映射，明确输入、输出、分页/影响列表和 requestId。
3. 实现教室 repository：列表、创建、更新、启停、容量校验、未来课次保护和审计。
4. 实现补课 repository：资格检查、目标课次关联、幂等、有效成员读取、结课课消衔接和审计。
5. 实现班级 pause/resume repository：预览、保留/取消未来课次、规则/课次写入门禁、审计。
6. 将单次排课、周期规则、规则生成、批量调课和入班接入 roomId、启停和容量校验。
7. 将点名名单与课消流程接入有效补课成员，保持来源课次事实冻结。
8. 增加 PostgreSQL 集成测试：权限、历史兼容、容量边界、停复课分支、补课幂等/并发、教室停用保护。
9. 增加 Web 教室 Tab、停复课确认/预览、补课弹窗和资源 Select；验证桌面与 390px 移动布局。
10. 运行类型检查、集成测试、Biome 检查和必要的浏览器验证，修复本任务范围内问题。

## 验证命令

```bash
pnpm --filter @easy-training/db exec tsc -p tsconfig.json --noEmit
pnpm check-types
pnpm test:integration
pnpm check
```

## 风险与回滚点

- 第 1 步 migration/schema 是最大回滚点；先生成并审阅 SQL，再执行测试库迁移。
- 第 4/7 步可能影响现有点名名单和课消，必须先补集成测试再接 Web。
- 第 6 步需兼容旧 room 文本，任何 roomId 非空约束都不得在首期加入。
- 前端改动优先拆分独立组件，避免继续膨胀 `academic-workspace.tsx`。

## 启动前检查

- PRD 已收敛：补课、停复课、容量与教室停用边界均已确认。
- 实现保持历史课次冻结、服务端授权、事务、幂等和审计约束。
- Issue #24 验收项与本计划步骤一一对应。

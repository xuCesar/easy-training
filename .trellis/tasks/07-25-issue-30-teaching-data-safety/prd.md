# Issue 30 教学仓储兼容与并发保障

## Goal

证明并补足教学领域中历史教室文本冲突判断、教室写入、补课安排与排课并发的安全边界，不改变现有业务规则或历史数据。

## Confirmed Facts

- `packages/db/src/repositories/teaching.ts` 的 `normalizeRoom` 已使用 `trim()`、Unicode `NFKC`、空白折叠与中文 locale 小写；`scheduling.ts` 的候选冲突、批量调课与规则生成均通过它比较历史文本。
- `packages/db/tests/teaching.integration.ts` 已覆盖部分单次排课与周期规则并发，但缺少 Issue #30 所要求的全角历史教室回归案例，以及教室写入/补课与排课之间的并发覆盖。
- 教室相关写入遵守“机构 advisory lock / 当前权限重验 -> classroom 行锁”；改变此顺序会与排课、补课形成死锁风险。

## Requirements

### R1. 历史教室文本兼容

为已有 `normalizeRoom` 和排课冲突路径补集成回归测试：同校区、时间重叠且文本仅全角/半角不同的历史教室必须冲突；原始 `lesson.room` 文本保持不变。

### R2. 并发边界

补覆盖教室写入、补课安排和排课同时竞争资源时的集成测试。测试必须断言结果不会越过教室启停、容量或时间/教室冲突规则，且所有失败为明确领域错误。

### R3. 范围控制

不修改 schema、API 合同、锁顺序、容量口径或历史数据；若测试揭示真实缺陷，仅在最小仓储边界修复并保留回归测试。

## Acceptance Criteria

- [x] AC1：全角/半角等价历史教室的重叠排课被拒绝，原始文本未被改写。
- [x] AC2：同一来源补课的并发竞争只保留一条有效安排；现有教室/排课并发覆盖继续通过。
- [x] AC3：相关 PostgreSQL 集成测试通过；无 schema 迁移或 ORPC 合同变更。

## Out of Scope

- 教室名称数据回填、规则变更、锁顺序重构或任何新的排课能力。

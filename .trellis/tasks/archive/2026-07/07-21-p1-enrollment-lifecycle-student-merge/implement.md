# 实施计划：报名生命周期与学员联系人查重合并

## 顺序清单

1. 盘点所有以 `enrollment.status = active` 或 `classGroupId` 推导班级成员、容量、点名和补课的查询，抽出按 `lesson.startsAt` 解析生命周期成员资格的 DB helper，并补当前行为回归测试。
2. 新增 schema / migration：`frozen` 状态、报名版本、生命周期事件、标准化号码字段、合并映射与审计 action；审阅 SQL、生成快照并先应用到测试库。
3. 实现报名生命周期 repository 和 API contracts：冻结、复课、转班、退班、重新分班，覆盖版本、幂等、权限、班级/教室容量、历史成员资格与审计。
4. 让班级名单、未来容量、点名、完成课次和补课统一复用成员资格 helper；确保历史课次和冻结区间不被后续复课重写。
5. 实现标准化手机号与疑似重复查询，接入创建学员、编辑联系人、独立报名的新建路径；提示不阻断提交。
6. 实现合并 preview / submit：锁定双档案、冲突字段显式选择、联系人/标签去重、关联迁移、源档案只读映射、审计与幂等；先覆盖阻断冲突再开放 UI。
7. 完成 Web：报名生命周期动作、受影响未来课次提示、通用确认弹窗、疑似重复候选、合并预览和确认；限制合并入口给 owner/admin。
8. 运行集成、类型、静态、构建及桌面/移动浏览器验证；为共享报名/点名查询执行线索转报名、独立报名、补课、续费/转课回归。

## 验证命令

```bash
pnpm db:migrate
pnpm check-types
pnpm test:integration
pnpm check
pnpm build
git diff --check
```

## 必测场景

- 多课程学员：冻结/复课英语报名不影响美术报名；冻结区间的已生成待上课次在复课后仍不进入点名。
- 转班、退班和重新分班只影响生效时点之后的课次；旧课次的考勤、课消、班级归属读取不变。
- 冻结、转班、补课并发时，目标班级与教室容量、补课重复和版本冲突正确拒绝，无部分写入。
- 跨机构/越权/成员撤销、停用班级、课程不匹配、陈旧版本、重复 request ID 和不同载荷 request ID 全部覆盖。
- 标准化号码提示覆盖主监护人、次联系人、`+86` 与格式符差异、跨校区命中、跨机构隔离；不匹配姓名/生日。
- 合并覆盖联系人/标签并集、字段选择、业务关联守恒、源档案拒绝写入、审计可追溯、同课程有效报名和考勤唯一性冲突阻断、事务回滚与重放。

## 高风险文件与回滚点

- `packages/db/src/schema/training.ts` 与新 migration：先验证 enum/索引/backfill，避免破坏现有报名和电话数据。
- `packages/db/src/repositories/teaching.ts`：成员资格 helper 会影响点名、课消、容量和补课，必须以集成测试证明不改变无生命周期事件的现有行为。
- `packages/db/src/repositories/students.ts`：合并涉及多表关联和权限，所有关联更新必须在单一事务内，且不得遗漏源档案写入拦截。
- `packages/api/src/contracts/training.ts`、`packages/api/src/routers/index.ts` 与 Web 调用方：先稳定错误/响应契约，再接入 UI，避免前后端对生效时点和冲突字段理解不一致。

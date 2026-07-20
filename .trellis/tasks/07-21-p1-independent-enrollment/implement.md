# 实施计划：独立报名入口与原子建档开单

## 顺序清单

1. 补齐 contracts、错误码和路由草案：独立报名 options/create、requestId、replayed 与结构化冲突响应。
2. 新增 `enrollment_registration` schema/migration、`enrollment_created` audit action 和关系/索引；审阅 SQL 后再执行测试库迁移。
3. 抽取报名创建共享校验：机构/校区授权、学生状态、同课程有效报名、课程套餐、班级/教室容量和锁顺序；让线索转化保持现有行为并增加续费引导冲突。
4. 实现独立报名 DB/API repository：已有/新建学员、主要联系人、暂不分班/直接入班、幂等重放、输入指纹、审计和事务回滚。
5. 增加 PostgreSQL 集成测试：两种学员路径、权限撤销、跨机构/校区、停用资源、容量/重复入班、同课程续费冲突、幂等载荷冲突、并发最后名额和回滚。
6. 实现 Web 独立报名弹窗并接入学员中心：分页搜索已有学员、最小新建资料、课程/班级依赖筛选、套餐权限、提交中/错误/成功和收款入口。
7. 补线索转化回归和文档/路线图状态：确认 `leadId` 语义、现有入口不回归，并同步 Issue #6/#25 的验收进度。
8. 运行类型检查、Biome、构建、集成测试和桌面/移动端浏览器验证；修复本任务范围内问题后再归档。

## 验证命令

```bash
pnpm --filter @easy-training/db exec tsc -p tsconfig.json --noEmit
pnpm check-types
pnpm test:integration
pnpm check
pnpm build
git diff --check
```

## 风险与回滚点

- 第 2 步 migration/schema 是首要回滚点；不得覆盖现有 enrollment/invoice 数据。
- 第 3 步共享报名 helper 影响线索转化；先补测试，再切换调用方。
- 第 4 步新学员与账单的事务边界必须保持原子，任何审计或幂等记录失败都回滚。
- 第 5 步不要用全局唯一索引掩盖历史重复数据；并发测试必须验证锁而非执行顺序。
- 第 6 步前端不得把课程/班级选项当作授权依据，错误响应和输入保留必须可见。

## 进入实现前检查

- [x] 用户确认新建学员只填写一位主要联系人。
- [x] 用户确认同课程有效报名使用续费，不重复创建报名。
- [ ] PRD、设计和实施计划完成最终评审。
- [ ] 用户明确批准执行 `task.py start` 进入实现阶段。

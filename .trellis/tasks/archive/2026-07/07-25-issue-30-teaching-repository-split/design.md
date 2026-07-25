# 教学仓储模块拆分设计

## 边界

- DB foundation：错误类型、写权限、校区/课程/教师/教室校验与共享事务类型。
- DB catalog/classes/lessons/makeups/attendance：按教学事实职责移动现有实现。
- DB scheduling rules/bulk：规则排课与批量调课分别维护，共享纯工具。
- API catalog/scheduling/classes/lessons：只做合同到 DB record 的适配和错误映射。

原 `teaching.ts`、`scheduling.ts` 及 API `teaching.ts` 保留为纯 re-export façade。内部模块直接依赖 foundation，不反向依赖 façade，避免 ESM 循环。`TeachingRepositoryError` 只在 foundation 定义一次，保证 `instanceof` 语义。

## 兼容与回滚

不改 `packages/db/src/index.ts`、API router、Zod 合同、schema 或迁移。移动函数体时保持事务回调、锁获取、幂等指纹和错误码原样。任一阶段可回退该结构提交，无数据回滚。

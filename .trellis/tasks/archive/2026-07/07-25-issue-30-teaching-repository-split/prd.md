# Issue 30 教学仓储模块拆分

## Goal

按稳定领域边界拆分 teaching/scheduling 巨型仓储，保持公开导出、ORPC 合同和业务行为不变。

## Requirements

- 将 `packages/db` 的 teaching/scheduling 实现按稳定领域边界拆为内部模块，原路径保留为兼容 façade。
- 将 `packages/api` 的 teaching adapter 按课程教师、排课、班级报名、课次考勤边界拆分，router 与合同保持不变。
- `TeachingRepositoryError`、权限校验、事务类型和锁顺序保持单一来源，不复制业务规则。
- 保持 `@easy-training/db` 根导出和 `@easy-training/db/repositories/{teaching,scheduling}` 深路径导出兼容。
- 不修改 schema、migration、ORPC 路径、输入输出合同或数据库行为。

## Acceptance Criteria

- [x] DB teaching/scheduling 原文件成为兼容 façade，业务实现进入职责明确的内部模块。
- [x] API teaching repository 成为兼容 façade，router 与合同文件无需修改。
- [x] 拆分前后的公开导出名称、错误类型身份、事务和锁行为保持不变。
- [x] DB/API 类型检查、全仓类型、Biome、构建和集成测试通过。

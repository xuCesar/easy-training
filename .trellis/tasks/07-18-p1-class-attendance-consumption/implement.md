# P1 实施计划：入班、考勤与课时消耗

1. 扩展 schema 与 migration：消耗账本、考勤审计字段和查询索引。
2. 在 DB repository 实现报名归属、课次点名读取与结课事务，定义领域错误。
3. 扩展 Zod contracts、API repository/router 和缓存失效范围。
4. 在教务工作台提供班级成员与课次点名/结课操作。
5. 补 PostgreSQL 集成测试，覆盖权限、课时不足、重复与并发结课。
6. 执行 `pnpm db:migrate`、`pnpm check-types`、`pnpm test:integration`、`pnpm check`、`pnpm build`，并进行桌面/移动端浏览器验收。

## Review Gates

- 不允许直接修改 `remainingLessons` 而没有唯一消耗流水。
- 入班和结课均在服务端按当前成员范围重新授权。
- 结课失败不得留下部分考勤、消耗或余额更新。

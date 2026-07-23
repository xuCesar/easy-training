# 技术设计：财务分析 Mock 性能验收

## 环境边界

- 复用本项目本地 PostgreSQL 容器（端口 5433），新建独立数据库 `easy-training-mock`。
- 不删除或改写 `easy-training` 开发数据库；所有脚本以显式数据库名或显式连接串定位 mock 库。
- 使用既有 Drizzle migration 建表，不使用 `db:push`。

## 合成数据与查询形态

- 使用无真实个人信息的确定性 UUID、名称与金额，生成多个机构和校区。
- 财务数据覆盖 invoice、invoice_metric_fact、payment、payment_reversal、refund 与 invoice_adjustment 的真实关联和时间分布；同时保留少量未归属与异常链样本。
- 数据规模按可配置档位生成，并包含高基数全机构和低基数单校区场景。
- 性能脚本仅执行 summary、financialDrilldown、financialAgingDrilldown 对应 SQL 的 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`；结果去除真实连接信息并写为可提交的摘要/不可提交的原始输出。

## 决策规则

- mock 结果用于发现明显慢路径和比较索引前后差异，不能替代生产真实数据量结论。
- 仅当重复测试显示具体查询形态存在扫描/缓冲区读取瓶颈时，才提出 additive 索引 migration；写入成本与回滚说明必须同步记录。

## 安全与回滚

- mock 库可在后续任务完成后整体删除；本轮创建本身不影响应用默认 `DATABASE_URL`。
- 不将完整连接串、原始 explain 结果或任何真实数据提交到仓库。

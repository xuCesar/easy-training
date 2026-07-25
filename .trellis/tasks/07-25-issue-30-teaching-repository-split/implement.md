# 实施计划

1. 提取 DB teaching foundation，并将内部调用方改为直接依赖 foundation。
2. 按 catalog、classes、lessons、makeups、attendance 移动 teaching 实现，保留 façade。
3. 将 scheduling 拆为 rules 与 bulk lesson update 模块，保留 façade。
4. 将 API teaching adapter 拆为 support、catalog、scheduling、classes、lessons，保留 façade。
5. 比较原公开导出集合，运行 DB/API 局部类型检查后执行全仓检查、构建和集成测试。
6. 以单独提交完成本子任务，再归档并关闭 GitHub #30。

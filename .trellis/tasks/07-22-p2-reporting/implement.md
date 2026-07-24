# P2 保存筛选与即时 CSV 导出实施计划

## 有序清单

- [ ] 盘点现有 analytics query、角色矩阵、CSV 转义、审计写入与迁移命名，定义共享 report config schema。
- [ ] 新增保存筛选 schema、数据库表/迁移、repository 与本人/机构隔离集成测试。
- [ ] 新增 analytics saved-filters 与 export oRPC 过程；导出复用既有服务端指标过程并记录最小审计摘要。
- [ ] 扩展 analytics 页面：保存、重命名、应用、删除、导出，以及加载、失效、超限和无权状态。
- [ ] 补齐 CSV BOM、公式转义、角色脱敏、排序/范围一致性、行数/响应限制及审计测试。
- [ ] 使用桌面与 390px 页面验证三个标签保存筛选、应用、导出与无权提示。
- [ ] 运行全量集成测试、类型检查、Biome、生产构建与差异检查；完成 spec 更新、提交与归档。

## 验证命令

```bash
pnpm test:integration
pnpm check-types
pnpm check
pnpm build
git diff --check
```

## 风险与回滚

- API 与 CSV 都必须使用当前会话范围；不得以保存记录或前端缓存绕过服务端权限。
- PostgreSQL enum 新值不可安全删除；功能回滚通过停止新接口和 UI 入口实现，保留审计值与新增表。
- 若同步响应超过上限，返回可理解错误；不降级为后台报表或空文件。

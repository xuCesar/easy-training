# 技术设计：P2 多维经营对比页面

## 边界

- 扩展现有 `apps/web/src/features/training/business-analytics.tsx`，不新建平行分析入口。
- 复用 `training.analytics` 现有 sales、attendance、consumption、renewal、financial、resource 契约；页面不复制公式、不直接访问数据库。
- 本任务只交付页内标签、维度筛选/表格和受控下钻；保存筛选与 CSV 另由后续子任务实现。

## 页面数据流

`session/organization scope → oRPC analytics queries → Zod result envelope → tab/metric cards/table → existing drilldown/deep links`。

- 经营概览复用现有招生、教学、消课、续费指标。
- 经营对比先复用可用的服务端维度结果；若某维度暂无服务端聚合契约，补充统一 registry 入口，不在 React 中按明细重算。
- 资源与财务标签按角色并行请求可见的 resource/financial 查询；无权标签不发请求。

## 角色与状态

- owner/admin：全机构或授权范围内的全部维度行和下钻。
- campus_manager：仅授权校区；隐藏行不能通过总数、排名或 Top/Bottom 推断。
- finance：仅财务标签及其授权校区，不渲染教学/招生无权内容。
- consultant：本人招生与脱敏校区基准；样本少于 5 的比例不排名。
- teacher：本人利用率和本人班级教学事实。

## 交互与响应式

- 使用现有 Tabs、卡片、表格、Skeleton、Empty 和错误提示组件；核心信息在 390px 宽度下纵向呈现，不依赖整页横向滚动。
- 所有请求有加载、错误、空、无权、未配置、历史覆盖不足和样本不足状态。
- 比率直接显示服务端 `available/notApplicable` 语义；负数回款显示金额，不将其裁剪为零。

## 兼容与回滚

- 仅新增前端组件状态和必要 API 维度契约；保持现有 analytics 路由和旧指标标签可访问。
- 若任一新标签异常，可由标签开关移除该标签，不影响既有概览和财务页面。

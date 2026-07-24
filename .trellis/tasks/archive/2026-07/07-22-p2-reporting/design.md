# 技术设计：P2 保存筛选与即时 CSV 导出

## 边界与数据流

`页面筛选状态 → analytics.reportFilters / analytics.export → 当前会话组织与角色解析 → 统一经营指标过程 → 受限 CSV / 保存筛选记录`。

- 经营分析仍是唯一 UI 入口；不新增独立报表页、后台任务或对象存储。
- 保存筛选仅保存标签、时间范围、对比维度和排序，所有字段由共享 Zod schema 限制。
- 应用筛选与导出时重新解析当前机构、角色和校区范围；持久化配置不携带权限快照。
- 本设计对齐父任务 `07-22-p2-operations-analytics/design.md` 的 Reporting Design：成员私有配置、当前权限重验、服务端同步 CSV、公式防护与超限拒绝均为不可突破的公共约束。

## 持久化与迁移

新增 `analytics_saved_filter`：`id`、`organization_id`、`user_id`、`name`、`report_kind`、`config`、`created_at`、`updated_at`。

- `organization_id` 级联删除，`user_id` 删除时级联；唯一索引为 `(organization_id, user_id, report_kind, name)`，列表索引为 `(organization_id, user_id, updated_at, id)`。
- `config` 是版本化、Zod 校验的 JSON；不保存 SQL、列表结果、金额、对象 ID 或访问范围。
- 新增审计 action `analytics_filter_saved`、`analytics_filter_updated`、`analytics_filter_deleted`、`analytics_exported`，审计 only 记录 report kind、配置摘要与行数/失败码。
- 迁移只新增表、枚举值和索引；无旧数据回填。回滚时先停止新接口，再删除表；已写审计枚举值保留，避免 PostgreSQL enum 回退风险。

## API 契约

`training.analytics` 新增：

- `savedFilters.list`：只列当前机构、当前成员的记录。
- `savedFilters.create / update / delete`：只操作本人记录；名字、标签和配置在 API 入口校验。
- `export`：接收当前受限 report config，服务端重新调用已存在的指标/对比过程，返回 `fileName`、`csv`、`rowCount` 与元数据。

统一配置含 `reportKind: overview | comparison | resourceFinance`、`range`，且 comparison 额外含 `dimension`、`sortBy`、`sortDirection`。导出不接受客户端传入行、金额、角色、机构或校区。

## 权限与投影

- 所有过程使用 `organizationProcedure` 提供的 `organizationId`、角色、`campusAccess` 与当前 `userId`。
- 导出复用现有指标过程和 comparison 服务端裁剪，不从 React 缓存或客户端结果生成 CSV。
- consultant / teacher 不导出金额字段；finance 只允许资源与财务摘要；无权标签、失效维度或角色变化返回明确 `FORBIDDEN` / `BAD_REQUEST`，不暴露已保存名称或隐藏统计。
- 对比导出保留当前服务端排序；概览与资源财务仅输出当前可见指标的一行摘要及通用元数据。

## 限制、错误与回滚

- 最大自定义范围 366 天、最大 1,000 行、最大 UTF-8 CSV 响应 1 MiB；失败不返回空下载文件，也不创建后台任务。
- CSV 使用 UTF-8 BOM 和既有公式前缀转义；行名、标签及元数据均经过 `quoteCsv`。
- 保存筛选可在前端提示配置不可用，但服务端始终是最终裁决。
- 若导出接口异常，可隐藏导出按钮并保留既有 `/analytics` 指标能力；保存筛选表与 API 无写入业务事实，不影响经营计算。

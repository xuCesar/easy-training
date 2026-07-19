# 技术设计

## 边界

本期在现有 `packages/db`、`packages/api` 和 `apps/web` 中实现。数据库 repository 是唯一的持久化入口；API router 仅处理契约和服务端上下文；Web 通过既有 oRPC/TanStack Query 调用。

## 审计

保留 `organization_audit_event` 表作为单一不可变审计事实源。扩展动作枚举并新增 `campusId`、可选请求关联 ID 与针对时间/校区筛选的索引。写入仅由内部 `writeOrganizationAuditEvent` helper 完成，公开 API 只读。历史记录的 `campusId` 允许为空以兼容既有数据。

## 通知

新增 `organization_notification`：机构、收件人、可选校区、类别、标题、正文、关联对象、幂等键、已读时间和创建时间。唯一键为 `(organization_id, recipient_user_id, idempotency_key)`；读取始终按当前用户与机构限制。内部 dispatcher 负责持久化站内渠道，业务动作在事务成功后调用；投递失败被记录并不回滚业务。

## 导入导出

CSV 解析与字段校验放在 API repository，按限制的表头和最大行数同步执行。预览只解析不写库；确认导入使用 requestId 建立 `lead_import_batch` 并在事务中写有效线索、活动记录和审计记录。每行包含行号和问题；已存在 requestId 返回已完成结果，避免刷新/重试重复插入。

导出继续返回 UTF-8 BOM CSV 字符串。导出后写审计事件，导出失败不产生审计事件。输入筛选和 campus scope 复用已有线索查询逻辑。

## 权限与兼容性

- 审计列表：机构管理角色；校区过滤由服务端成员 scope 收窄。
- 导入、模板和导出：线索管理角色；负责人字段只能解析为本机构成员。
- 通知：任何已认证成员仅能操作自己的通知。
- 新表均有 `organizationId`；关联资源读取需验证同机构，不能单靠 UUID。

## 交互

在线索页增加导入入口和模板下载，使用三步对话框：选择文件、预览错误、确认导入。机构设置内提供审计记录页签；全局导航增加通知铃铛和未读角标。

## 回滚

新增表与 nullable 审计字段均为向后兼容迁移。发生问题时可停止新 API/UI 调用而保留历史记录；不删除任何业务数据。通知和导入批次均可作为后续异步渠道或文件任务的稳定扩展点。

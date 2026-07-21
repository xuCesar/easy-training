# 退款审批闭环技术设计

## Architecture and Ownership

- DB schema 放在 `packages/db/src/schema/training.ts`，领域写入放在新的 `packages/db/src/repositories/refund-approval.ts`，避免继续膨胀报名财务变更 repository。
- API contract 继续集中在 `packages/api/src/contracts/training.ts`；映射与错误翻译放在 `packages/api/src/repositories/refund-approval.ts`；路由挂在 `training.finance.refundRequests`。
- Web 入口位于现有账单详情，退款表单改为申请表单，并新增审批状态卡、历史和批准/拒绝/取消操作。
- 现有 `refund` 保持批准后的唯一资金流水；申请和审批事实不参与金额聚合。

## Data Model

新增枚举：

- `refund_request_status`: `pending | approved | rejected | cancelled`
- `refund_request_action`: `submitted | approved | rejected | cancelled`

新增 `refundRequest`：

- 归属：`organizationId`、`campusId`、`invoiceId`
- 申请快照：`amountInCents`、`refundedAt`、`method`、`reason`
- 申请人：`applicantUserId`、`applicantName`
- 当前投影：`status`、`version`、可空 `refundId`
- 幂等：`submissionRequestId`、`inputHash`
- 时间：`createdAt`、`updatedAt`

约束：

- `(organizationId, submissionRequestId)` 唯一。
- 金额为正、版本为正。
- `(organizationId, invoiceId) WHERE status = 'pending'` 部分唯一索引。
- `refundId` 唯一，确保一个批准申请最多对应一条退款。

新增 `refundRequestEvent`：

- `refundRequestId`、`action`、`fromStatus`、`toStatus`
- 可空 `comment`，保存批准意见、拒绝原因或取消原因
- `operatorUserId`、`operatorName`、`requestId`、`createdAt`
- `(organizationId, requestId)` 唯一；历史只追加，不更新或删除。

申请表保存当前状态以便筛选，事件表保存不可变历史；所有状态变化同时更新投影并插入事件。

## Command Contracts

- `createRefundRequestRecord(input)`：创建待审批申请和 `submitted` 事件。
- `decideRefundRequestRecord({ action: approve | reject, expectedVersion, ... })`：管理员审批。
- `cancelRefundRequestRecord({ expectedVersion, ... })`：申请人或管理员取消。
- `listInvoiceRefundRequestRecords(...)`：按账单返回当前申请与倒序事件历史。

所有命令带 UUID `requestId`。同一请求与相同规范化载荷返回首次结果；不同载荷返回 `IDEMPOTENCY_CONFLICT`。

## Transaction and Authorization Flow

创建申请：

1. 使用 `getCurrentFinanceWriteCampusAccess` 获取机构 advisory lock，并重读成员角色与校区范围。
2. `FOR UPDATE` 锁账单，校验学员校区启用且可访问。
3. 先处理幂等重放，再校验账单仍为可退款状态、申请金额合法且不存在待审批申请。
4. 插入申请、提交事件和 `refund_request_submitted` 中央审计。

批准/拒绝/取消：

1. 获取相同机构锁并重读操作者角色；批准/拒绝额外要求 `admin | owner`。
2. `FOR UPDATE` 锁申请，再按固定顺序锁账单；校验 `pending` 与 `expectedVersion`。
3. 批准时拒绝申请人自审，重新聚合最新退款余额，并复用现有退款写入与报名累计已收重算 helper。
4. 在同一事务插入 `refund`、事件、更新申请投影并写中央审计；任一步失败全部回滚。
5. 拒绝/取消只写事件与投影，不创建资金流水。

审批与后续冲正都先锁账单，因此批准和冲正并发时只能按一个确定顺序完成。

## API and Error Semantics

API 暴露：

- `refundRequests.list({ invoiceId })`
- `refundRequests.create(input)`
- `refundRequests.decide({ requestId, action, comment, expectedVersion })`
- `refundRequests.cancel({ requestId, reason, expectedVersion })`

明确区分：资源不存在 `NOT_FOUND`；角色/校区/自审批 `FORBIDDEN`；重复待审批、终态、版本或余额变化 `CONFLICT`；缺失必填原因和非法金额/时间 `BAD_REQUEST`。

现有 `training.finance.refunds.create` 被移除或改为不可调用的内部路径；退款列表读取保留，用于显示批准结果和历史旧数据。

扩展 invoice list/detail contract 支持 `refunded` 展示状态和筛选；默认 `open` 行为不变，稳定 ID 详情不再因 `invoice.status = refunded` 返回不存在。

## Web Flow

- 账单详情“登记退款”改为“申请退款”。提交成功后保留详情并显示“待审批”。
- 待审批卡显示金额、申请人、时间和状态；根据当前用户决定显示批准、拒绝或取消操作。
- 申请人本人不显示审批按钮；服务端仍执行最终拦截。
- 拒绝与管理员取消他人使用现有系统 Dialog 收集必填原因；提交中禁止关闭，成功后失效账单详情、列表、欠费和运营快照。
- 历史按事件显示，不从中央审计反向拼装自由文本。
- 财务筛选增加“已退款”；全额退款后保持当前详情可见，并可再次从列表进入。

## Compatibility and Rollout

- 数据库变更只新增表、枚举、索引和审计 action；既有 `refund` 不回填申请，展示为“历史直接退款”。
- 先应用 migration，再同版本发布 API/Web；发布后不再保留可绕过审批的公开写入口。
- 回滚应用前必须停用新退款申请写入；已批准生成的 `refund` 对旧读取逻辑仍兼容。

## Audit Boundary

新增中央审计 action：`refund_request_submitted | refund_request_approved | refund_request_rejected | refund_request_cancelled`。

审计只保存申请 ID、账单 ID、退款 ID、金额、前后状态、requestId 和审批人；`reason`、`comment` 不进入 `before/after`。

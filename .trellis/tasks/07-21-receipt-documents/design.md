# 收据与付款凭证技术设计

## Architecture and Ownership

- 新增 `packages/db/src/repositories/receipt-documents.ts`，负责编号分配、生成、作废、补开和当前资金状态聚合。
- API 暴露类型化 `ReceiptDocumentView`；领域快照与当前派生状态分开，Web 打印组件只消费该展示模型。
- Web 在账单详情的每条收款旁显示凭证状态与操作，凭证详情使用现有系统 Dialog/Sheet；打印时用专用 print CSS 隐藏导航和控件。
- 首版不引入 PDF 或图片依赖。

## Data Model

新增枚举 `receipt_status`: `active | voided`。

新增 `receiptNumberCounter`：

- `organizationId`、`yearMonth`、`lastSequence`
- `(organizationId, yearMonth)` 主唯一键。

分配编号时在凭证事务内原子 upsert 并 `RETURNING` 新序号，格式化为六位；凭证表另设 `(organizationId, number)` 唯一约束作为最终防线。序号只增不减，作废不回收。

新增 `receiptDocument`：

- 归属与编号：`organizationId`、`campusId`、`number`、`yearMonth`、`sequence`
- 当前状态：`status`
- 生成：`generatedByUserId`、`generatedByName`、`generatedAt`、`generationRequestId`、`inputHash`
- 快照版本：`snapshotVersion`
- 快照字段：机构名、校区名、学员 ID/姓名、账单 ID/摘要/总额、抬头、可空备注
- 补开链：可空 `replacesReceiptId`
- 作废：可空 `voidReason`、`voidedByUserId`、`voidedByName`、`voidedAt`、`voidRequestId`

约束：

- `(organizationId, generationRequestId)` 唯一。
- `(organizationId, voidRequestId) WHERE voidRequestId IS NOT NULL` 唯一。
- `(organizationId, number)` 与 `(organizationId, yearMonth, sequence)` 唯一。
- active/voided 与作废字段的一致性由 check 和 repository 同时保护。

新增 `receiptDocumentPayment` 关联表：

- `organizationId`、`receiptId`、`paymentId`、`amountInCents`、`receivedAt`、`method`、可空 `referenceNo`、`isActive`
- `(receiptId, paymentId)` 唯一。
- `(organizationId, paymentId) WHERE isActive = true` 部分唯一索引，保证同一收款最多一张有效凭证。

首版每张凭证插入一条关联；未来合并开具可插入多条。作废时保留关联并将 `isActive` 更新为 false；主体和关系均不删除。

## Snapshot and View Contract

生成时在同一事务锁定 payment、invoice，并读取组织、校区和学员名称；资金不可变字段进入快照。交款对象固定为账单学员，不读取或暴露联系人。

`ReceiptDocumentView` 分为：

- `document`：编号、状态、生成/作废/补开链和不可变快照。
- `payments[]`：原收款快照与关联金额，为未来多笔合并保留数组结构。
- `currentFinancialStatus`：每笔累计冲正、有效金额，及账单累计退款和查询时间。

退款与冲正只影响 `currentFinancialStatus`，不得更新历史快照。

## Commands and Locking

- `generateReceiptDocumentRecord({ paymentIds: [paymentId], title, note, requestId })`
- `voidReceiptDocumentRecord({ receiptId, reason, requestId })`
- `reissueReceiptDocumentRecord({ replacesReceiptId, title, note, requestId })`
- `getReceiptDocumentRecord({ receiptId, campusAccess })`

生成/补开固定锁顺序：机构 advisory lock/成员 → payment ID 排序逐行锁 → invoice → 当前 active 关联。首版数组长度必须为 1，但内部 contract 保留数组。

普通生成若同一 requestId 已完成则返回原凭证；若不同 requestId 发现 active 关联，则返回包含现有凭证 ID 的 `RECEIPT_ALREADY_EXISTS` 冲突，Web 直接打开现有凭证。这样每个成功 requestId 都有稳定持久化结果。补开要求被替换凭证已作废且资金关联完全一致，然后分配新编号。

作废锁 receipt 与其关联 payment，重读权限与校区，校验 active 后更新主体和关联投影；同一 void request 幂等，其他重复作废返回明确冲突。

## API

- `receipts.getByPayment({ paymentId })`：返回未开具或当前/最近凭证摘要。
- `receipts.get({ receiptId })`：返回完整 `ReceiptDocumentView`。
- `receipts.generate(input)`、`receipts.void(input)`、`receipts.reissue(input)`。

账单详情直接附每条 payment 的 receipt summary，避免 Web 对每行发 N+1 查询。所有读取继续按学员校区授权过滤。

错误区分不存在、越权、停用校区、已存在有效凭证、未作废不可补开、资金关联变化、幂等冲突与编号资源异常。

## Web and Print

- 收款行状态：未开具、有效、已作废；提供生成、查看、作废、补开入口。
- 生成失败只提示凭证错误，不回滚或误报原收款。
- 作废使用现有通用自定义确认 Dialog，原因必填；补开表单只开放抬头和备注。
- 凭证正文包含编号、机构/校区、学员、账单摘要、收款明细、当前资金状态、生成时间和打印查询时间。
- 打印按钮调用 `window.print()`；`@media print` 只展示凭证容器，使用固定白底、黑字、可分页表格，隐藏按钮、Dialog 装饰、导航和 Toast。
- 展示组件不直接查询数据、不调用浏览器 API；外层容器负责加载与打印，以便未来服务端 renderer 复用 view contract。

## Audit, Compatibility and Rollout

新增审计 action：`receipt_generated | receipt_voided | receipt_reissued`。审计不复制抬头、备注或作废原因，只保存 receipt/payment/invoice 标识、编号、状态和 requestId。

全部 schema 为 additive，无历史凭证回填；既有收款初始显示未开具。先部署 migration，再发布应用。产生凭证后回滚旧应用不会影响资金，但会隐藏凭证入口；回滚前应暂停凭证写操作。

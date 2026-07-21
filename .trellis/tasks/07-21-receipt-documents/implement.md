# 收据与付款凭证实施计划

## Scope Guard

- 首版一笔 payment 一张按需凭证，只提供系统内查看和浏览器打印/另存 PDF。
- 不新增 PDF/图片依赖，不实现自动开具、多笔合并、邮件或批量导出。
- 依赖退款审批和收款冲正已完成，凭证只能消费其稳定查询语义。

## Implementation Checklist

1. 数据库与迁移
   - 新增 receipt 状态、编号 counter、凭证主体和 payment 关联表。
   - 增加编号、generation/void request、active payment 关联等唯一/部分唯一约束与一致性 check。
   - 增加 `receipt_generated | receipt_voided | receipt_reissued` 审计 action。
2. DB repository
   - 新建 `packages/db/src/repositories/receipt-documents.ts`。
   - 实现机构月度编号原子分配、生成、读取、作废和补开。
   - 内部生成 contract 接收 payment ID 数组但首版强制长度为一；锁顺序按排序后 payment→invoice→active link。
   - 查询一次性聚合关联 payment 的 reversal 和 invoice refund，组装历史快照与当前状态。
3. API and view contract
   - 在 contract 中定义稳定的 `ReceiptDocumentView`：document、payments[]、currentFinancialStatus。
   - 增加 generate/get/void/reissue 输入输出与明确错误翻译。
   - 扩展 invoice detail 的 payment receipt summary，避免 N+1。
4. Web
   - 在收款行增加未开具/有效/已作废状态及快捷操作。
   - 新建凭证详情/打印组件；数据展示组件保持纯 props，外层负责 query、mutation 和 `window.print()`。
   - 作废使用系统通用 Dialog 且原因必填；补开只允许抬头和备注。
   - 增加 print CSS：隐藏导航/控件/Toast，白底黑字，表格跨页可读，打印时间明确。
   - 更新审计页 action/entity 标签。
5. 扩展边界核对
   - 关联与 view 均使用数组，不在业务核心写死单 payment；首版 API 校验数组长度为一。
   - 渲染组件不读取浏览器环境，未来服务端 renderer 可复用同一 view。
6. 规范
   - 更新财务与审计规范，记录编号不可复用、快照/当前状态分离和敏感信息边界。

## Required Tests

- 不同校区同机构并发生成编号唯一且格式正确；跨月从新序号开始；作废号不复用。
- 同 requestId 重放、不同载荷冲突、两个不同 requestId 并发点击同一 payment 最多一张 active 凭证。
- 作废幂等、重复作废冲突、补开新编号、新旧链正确、同 payment 仅新凭证 active。
- 越权、跨校区、停用校区、事务中撤权和资金关联变化。
- 部分/全部 reversal 当前金额及 invoice refund 提示正确，历史 snapshot 不变。
- 审计失败时 counter、凭证和关联完整回滚；自由文本不进入中央审计。
- Web 验证生成失败不影响 payment，作废/补开交互、桌面与 360–390px 布局。
- Chrome/目标浏览器实际打印与另存 PDF：无导航/按钮、编号和查询时间完整、分页不截断关键行。

## Validation Commands

```bash
pnpm db:generate
pnpm check-types
pnpm --filter server exec tsx --test ../../packages/db/tests/receipt-documents.integration.ts
pnpm check
pnpm build
pnpm test:integration
```

浏览器验证需启动 `pnpm dev`，在认证态分别检查桌面和移动尺寸，并人工打开打印预览。

## Review Gates and Rollback

- Gate 1：编号、active 关联和幂等的数据库并发证据通过。
- Gate 2：快照不含联系人和内部自由文本，当前资金状态不回写历史字段。
- Gate 3：view 使用 payment 数组且纯展示组件可脱离浏览器 API 渲染。
- Gate 4：真实打印/PDF 与响应式验证通过。
- 回滚前暂停凭证写入；新增表全部保留，资金事实不受影响，历史编号不得通过逆向 migration 回收。

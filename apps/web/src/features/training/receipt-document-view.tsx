import type { ReceiptDocumentView } from "@easy-training/api/contracts/training";

import { formatCentsToCurrency, formatDateTime } from "./format";

export function ReceiptDocumentViewContent({
	view,
}: {
	view: ReceiptDocumentView;
}) {
	const financialStatus = new Map(
		view.currentFinancialStatus.payments.map((item) => [item.paymentId, item]),
	);
	return (
		<article
			className="receipt-print-root min-w-0 bg-background text-foreground"
			aria-label={`收款凭证 ${view.document.number}`}
		>
			<header className="border-foreground border-b-2 pb-4 text-center">
				<p className="text-muted-foreground text-xs">
					{view.document.organizationName}
				</p>
				<h1 className="mt-1 font-semibold text-2xl">{view.document.title}</h1>
				<p className="mt-2 font-mono text-sm tabular-nums">
					{view.document.number}
				</p>
			</header>
			{view.document.status === "voided" ? (
				<div className="mt-4 border-2 border-destructive p-3 text-destructive">
					<p className="font-semibold">此凭证已作废</p>
					<p className="mt-1 break-words text-sm">
						原因：{view.document.voidReason}
					</p>
					<p className="mt-1 text-xs">
						{view.document.voidedAt
							? formatDateTime(view.document.voidedAt)
							: "-"}{" "}
						· {view.document.voidedByName ?? "-"}
					</p>
				</div>
			) : null}
			<dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
				<ReceiptDefinition label="交款学员" value={view.document.studentName} />
				<ReceiptDefinition label="所属校区" value={view.document.campusName} />
				<ReceiptDefinition
					label="账单摘要"
					value={view.document.invoiceSummary}
				/>
				<ReceiptDefinition
					label="账单应收"
					value={formatCentsToCurrency(view.document.invoiceAmountInCents)}
				/>
				<ReceiptDefinition
					label="开具时间"
					value={formatDateTime(view.document.generatedAt)}
				/>
				<ReceiptDefinition
					label="开具人"
					value={view.document.generatedByName}
				/>
			</dl>
			<section className="mt-5" aria-labelledby="receipt-payments-title">
				<h2 id="receipt-payments-title" className="font-semibold text-sm">
					收款明细
				</h2>
				<div className="receipt-payment-table mt-2 hidden border sm:block">
					<table className="w-full border-collapse text-left text-sm">
						<thead className="bg-muted/50">
							<tr>
								<th className="border-b p-2 font-medium">收款时间</th>
								<th className="border-b p-2 font-medium">方式 / 流水号</th>
								<th className="border-b p-2 text-right font-medium">原收款</th>
								<th className="border-b p-2 text-right font-medium">
									累计冲正
								</th>
								<th className="border-b p-2 text-right font-medium">
									当前有效
								</th>
							</tr>
						</thead>
						<tbody>
							{view.payments.map((payment) => {
								const current = financialStatus.get(payment.paymentId);
								return (
									<tr key={payment.paymentId}>
										<td className="border-b p-2 align-top">
											{formatDateTime(payment.receivedAt)}
										</td>
										<td className="border-b p-2 align-top">
											{getPaymentMethodLabel(payment.method)}
											{payment.referenceNo ? (
												<span className="mt-1 block break-all text-muted-foreground text-xs">
													{payment.referenceNo}
												</span>
											) : null}
										</td>
										<td className="border-b p-2 text-right align-top tabular-nums">
											{formatCentsToCurrency(payment.amountInCents)}
										</td>
										<td className="border-b p-2 text-right align-top tabular-nums">
											{formatCentsToCurrency(
												current?.reversedAmountInCents ?? 0,
											)}
										</td>
										<td className="border-b p-2 text-right align-top font-medium tabular-nums">
											{formatCentsToCurrency(
												current?.effectiveAmountInCents ??
													payment.amountInCents,
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
				<ol className="receipt-payment-cards mt-2 divide-y border sm:hidden">
					{view.payments.map((payment) => {
						const current = financialStatus.get(payment.paymentId);
						return (
							<li
								key={payment.paymentId}
								className="grid grid-cols-2 gap-3 p-3 text-sm"
							>
								<ReceiptDefinition
									label="收款时间"
									value={formatDateTime(payment.receivedAt)}
								/>
								<ReceiptDefinition
									label="收款方式"
									value={getPaymentMethodLabel(payment.method)}
								/>
								<ReceiptDefinition
									label="原收款"
									value={formatCentsToCurrency(payment.amountInCents)}
								/>
								<ReceiptDefinition
									label="累计冲正"
									value={formatCentsToCurrency(
										current?.reversedAmountInCents ?? 0,
									)}
								/>
								<div className="col-span-2">
									<ReceiptDefinition
										label="当前有效"
										value={formatCentsToCurrency(
											current?.effectiveAmountInCents ?? payment.amountInCents,
										)}
									/>
								</div>
								{payment.referenceNo ? (
									<p className="col-span-2 break-all text-muted-foreground text-xs">
										流水号：{payment.referenceNo}
									</p>
								) : null}
							</li>
						);
					})}
				</ol>
			</section>
			{view.currentFinancialStatus.invoiceRefundedAmountInCents > 0 ? (
				<div className="mt-4 border border-amber-600/40 bg-amber-600/5 p-3 text-sm">
					关联账单存在退款，累计退款{" "}
					{formatCentsToCurrency(
						view.currentFinancialStatus.invoiceRefundedAmountInCents,
					)}
					。退款不自动改变本凭证历史快照。
				</div>
			) : null}
			{view.document.note ? (
				<p className="mt-4 break-words border-t pt-3 text-sm">
					凭证备注：{view.document.note}
				</p>
			) : null}
			{view.document.replacesReceiptId ? (
				<p className="mt-3 text-muted-foreground text-xs">
					本凭证为补开凭证，原作废凭证记录永久保留。
				</p>
			) : null}
			<footer className="mt-6 flex flex-col gap-1 border-t pt-3 text-muted-foreground text-xs sm:flex-row sm:justify-between">
				<span>快照版本 V{view.document.snapshotVersion}</span>
				<span>
					查询 / 打印时间：
					{formatDateTime(view.currentFinancialStatus.queriedAt)}
				</span>
			</footer>
		</article>
	);
}

function ReceiptDefinition({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd className="mt-1 break-words">{value}</dd>
		</div>
	);
}

function getPaymentMethodLabel(
	method: ReceiptDocumentView["payments"][number]["method"],
): string {
	switch (method) {
		case "cash":
			return "现金";
		case "wechat":
			return "微信";
		case "alipay":
			return "支付宝";
		case "bankTransfer":
			return "银行转账";
		case "pos":
			return "POS";
		case "other":
			return "其他";
	}
}

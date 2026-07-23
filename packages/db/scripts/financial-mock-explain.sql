-- 本地性能验收专用：只允许连接 easy-training-mock 执行。
-- 输出为 EXPLAIN 计划，不返回学员或支付隐私字段。
\pset pager off

-- 1. 全机构、两年范围的净回款月度聚合。
EXPLAIN (ANALYZE, BUFFERS)
WITH events AS (
	SELECT p.received_at AS occurred_at, p.amount_in_cents AS signed_amount
	FROM payment p
	JOIN invoice_metric_fact f ON f.invoice_id = p.invoice_id AND f.organization_id = p.organization_id
	WHERE p.organization_id = '10000000-0000-4000-8000-000000000001'
		AND p.received_at >= now() - interval '2 years'
	UNION ALL
	SELECT r.reversed_at, -r.amount_in_cents
	FROM payment_reversal r
	JOIN invoice_metric_fact f ON f.invoice_id = r.invoice_id AND f.organization_id = r.organization_id
	WHERE r.organization_id = '10000000-0000-4000-8000-000000000001'
		AND r.reversed_at >= now() - interval '2 years'
	UNION ALL
	SELECT rf.refunded_at, -rf.amount_in_cents
	FROM refund rf
	JOIN invoice_metric_fact f ON f.invoice_id = rf.invoice_id AND f.organization_id = rf.organization_id
	WHERE rf.organization_id = '10000000-0000-4000-8000-000000000001'
		AND rf.refunded_at >= now() - interval '2 years'
)
SELECT date_trunc('month', occurred_at AT TIME ZONE 'Asia/Shanghai'), sum(signed_amount)
FROM events
GROUP BY 1
ORDER BY 1;

-- 2. 单校区资金下钻，稳定排序并限制 50 条。
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id, p.invoice_id, p.received_at
FROM payment p
JOIN invoice_metric_fact f ON f.invoice_id = p.invoice_id AND f.organization_id = p.organization_id
WHERE p.organization_id = '10000000-0000-4000-8000-000000000001'
	AND f.campus_id = '10000000-0000-4000-8000-000000000001'
	AND p.received_at >= now() - interval '2 years'
ORDER BY p.received_at, p.id
LIMIT 50;

-- 3. 单校区账龄下钻，读取截至当前时点的有效结算。
EXPLAIN (ANALYZE, BUFFERS)
SELECT i.id, i.issued_at, i.amount_in_cents - coalesce(s.settled, 0) AS outstanding
FROM invoice i
JOIN invoice_metric_fact f ON f.invoice_id = i.id AND f.organization_id = i.organization_id
LEFT JOIN (
	SELECT p.invoice_id, sum(p.amount_in_cents) - coalesce(sum(r.amount_in_cents), 0) AS settled
	FROM payment p
	LEFT JOIN payment_reversal r ON r.payment_id = p.id AND r.organization_id = p.organization_id
	WHERE p.organization_id = '10000000-0000-4000-8000-000000000001'
		AND p.received_at < now()
	GROUP BY p.invoice_id
) s ON s.invoice_id = i.id
WHERE i.organization_id = '10000000-0000-4000-8000-000000000001'
	AND f.campus_id = '10000000-0000-4000-8000-000000000001'
	AND i.issued_at < now()
ORDER BY i.issued_at, i.id
LIMIT 50;

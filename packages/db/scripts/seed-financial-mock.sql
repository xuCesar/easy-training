-- 本地性能验收专用：只允许连接 easy-training-mock 执行。
-- 使用固定组织 ID，重复执行会先清理上一轮 mock 数据，不涉及开发或生产库。
begin;

delete from organization where id = '10000000-0000-4000-8000-000000000001';

insert into "user" (id, name, email, email_verified)
values ('mock-finance-owner', 'Mock Finance Owner', 'mock-finance-owner@example.invalid', true)
on conflict (id) do update set name = excluded.name;

insert into organization (id, name)
values ('10000000-0000-4000-8000-000000000001', 'Mock Financial Performance Organization');

insert into campus (id, organization_id, code, name, city, address)
select
	('10000000-0000-4000-8000-' || lpad(campus_no::text, 12, '0'))::uuid,
	'10000000-0000-4000-8000-000000000001'::uuid,
	format('mock-%s', campus_no),
	format('Mock Campus %s', campus_no),
	'Shanghai',
	'Mock address'
from generate_series(1, 8) as campus_no;

insert into student (organization_id, campus_id, name, guardian_name, guardian_phone, guardian_phone_normalized, status)
select
	'10000000-0000-4000-8000-000000000001'::uuid,
	('10000000-0000-4000-8000-' || lpad((((student_no - 1) % 8) + 1)::text, 12, '0'))::uuid,
	format('Mock Student %s', student_no),
	'Mock Guardian',
	('139' || lpad(student_no::text, 8, '0')),
	('139' || lpad(student_no::text, 8, '0')),
	'active'
from generate_series(1, 10000) as student_no;

with students as (
	select array_agg(id order by id) as ids
	from student
	where organization_id = '10000000-0000-4000-8000-000000000001'
)
insert into invoice (organization_id, student_id, source, business_activity_type, summary, amount_in_cents, paid_amount_in_cents, status, due_date, issued_at, created_by_user_id, created_by_name)
select
	'10000000-0000-4000-8000-000000000001'::uuid,
	students.ids[((invoice_no - 1) % 10000) + 1],
	'manual',
	'other',
	'mock-performance',
	10000 + ((invoice_no % 20) * 500),
	0,
	'pending',
	(current_date - ((invoice_no % 730) + 1))::date,
	(now() - make_interval(days => ((invoice_no % 730) + 1))),
	'mock-finance-owner',
	'Mock Finance Owner'
from generate_series(1, 200000) as invoice_no
cross join students;

insert into invoice_metric_fact (invoice_id, organization_id, campus_id, campus_attribution_kind, campus_name_snapshot, course_attribution_kind, source, provenance, occurred_at)
select
	i.id,
	i.organization_id,
	s.campus_id,
	'linked',
	format('Mock Campus %s', right(s.campus_id::text, 1)::int),
	'not_applicable',
	'manual',
	'native',
	i.issued_at
from invoice i
join student s on s.id = i.student_id
where i.organization_id = '10000000-0000-4000-8000-000000000001';

insert into payment (organization_id, invoice_id, amount_in_cents, received_at, method, operator_user_id, operator_name, request_id)
select
	i.organization_id,
	i.id,
	(i.amount_in_cents * case when mod(abs(hashtext(i.id::text)), 4) = 0 then 50 else 100 end / 100)::int,
	i.issued_at + interval '7 days',
	'bank_transfer',
	'mock-finance-owner',
	'Mock Finance Owner',
	gen_random_uuid()
from invoice i
where i.organization_id = '10000000-0000-4000-8000-000000000001'
	and mod(abs(hashtext(i.id::text)), 100) < 70;

insert into payment_reversal (organization_id, campus_id, invoice_id, payment_id, amount_in_cents, reason, reversed_at, operator_user_id, operator_name, request_id)
select
	p.organization_id,
	f.campus_id,
	p.invoice_id,
	p.id,
	greatest(1, p.amount_in_cents / 5),
	'mock reversal',
	p.received_at + interval '3 days',
	'mock-finance-owner',
	'Mock Finance Owner',
	gen_random_uuid()
from payment p
join invoice_metric_fact f on f.invoice_id = p.invoice_id
where mod(abs(hashtext(p.id::text)), 100) < 5;

insert into refund (organization_id, invoice_id, amount_in_cents, refunded_at, method, reason, operator_user_id, operator_name, request_id)
select
	p.organization_id,
	p.invoice_id,
	greatest(1, p.amount_in_cents / 10),
	p.received_at + interval '10 days',
	'bank_transfer',
	'mock refund',
	'mock-finance-owner',
	'Mock Finance Owner',
	gen_random_uuid()
from payment p
where mod(abs(hashtext(p.id::text)), 100) between 5 and 7;

create temporary table mock_adjustments on commit drop as
select i.id, i.organization_id, f.campus_id, i.amount_in_cents as before_amount, i.due_date as before_due_date
from invoice i
join invoice_metric_fact f on f.invoice_id = i.id
where i.organization_id = '10000000-0000-4000-8000-000000000001'
	and mod(abs(hashtext(i.id::text)), 100) = 8;

update invoice i
set amount_in_cents = a.before_amount + 500,
	due_date = a.before_due_date + 7,
	version = 2
from mock_adjustments a
where i.id = a.id;

insert into invoice_adjustment (organization_id, invoice_id, campus_id, request_id, input_hash, before_version, after_version, before_amount_in_cents, after_amount_in_cents, before_due_date, after_due_date, before_summary, after_summary, reason, operator_user_id, operator_name, created_at)
select organization_id, id, campus_id, gen_random_uuid(), 'mock-adjustment', 1, 2, before_amount, before_amount + 500, before_due_date, before_due_date + 7, 'mock-performance', 'mock-performance', 'mock adjustment', 'mock-finance-owner', 'Mock Finance Owner', now() - interval '1 day'
from mock_adjustments;

analyze;
commit;

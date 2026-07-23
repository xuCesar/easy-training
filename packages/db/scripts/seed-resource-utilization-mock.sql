-- 资源利用查询计划专用；仅连接 easy-training-mock 执行。
-- 固定独立机构，重复执行只清理本脚本创建的数据，不影响财务 mock 数据。
begin;

delete from organization where id = '20000000-0000-4000-8000-000000000001';

insert into organization (id, name)
values ('20000000-0000-4000-8000-000000000001', 'Mock Resource Utilization Organization');

insert into campus (id, organization_id, code, name, city, address)
select
	('20000000-0000-4000-8000-' || lpad(campus_no::text, 12, '0'))::uuid,
	'20000000-0000-4000-8000-000000000001'::uuid,
	format('resource-%s', campus_no), format('Resource Campus %s', campus_no), 'Shanghai', 'Mock address'
from generate_series(1, 4) as campus_no;

insert into course (id, organization_id, code, name, category, level, duration_minutes, list_price_in_cents, lessons_per_package, tags)
values ('20000000-0000-4000-8000-000000000100', '20000000-0000-4000-8000-000000000001', 'RESOURCE-MOCK', 'Resource Mock Course', 'language', 'L1', 60, 100000, 100, '{}');

create temporary table resource_teachers on commit drop as
select gen_random_uuid() as id, teacher_no,
	('20000000-0000-4000-8000-' || lpad((((teacher_no - 1) % 4) + 1)::text, 12, '0'))::uuid as campus_id
from generate_series(1, 80) as teacher_no;

insert into teacher (id, organization_id, name, subjects, weekly_capacity_hours)
select id, '20000000-0000-4000-8000-000000000001', format('Resource Teacher %s', teacher_no), array['英语'], 30
from resource_teachers;

insert into teacher_campus (teacher_id, campus_id)
select id, campus_id from resource_teachers;

insert into teacher_capacity_history (organization_id, teacher_id, weekly_capacity_minutes, effective_from)
select '20000000-0000-4000-8000-000000000001'::uuid, id, 1800, current_date - interval '2 years' from resource_teachers
union all
select '20000000-0000-4000-8000-000000000001'::uuid, id, 2100, current_date - interval '1 year' from resource_teachers;

create temporary table resource_groups on commit drop as
select gen_random_uuid() as id, id as teacher_id, campus_id, teacher_no from resource_teachers;

insert into class_group (id, organization_id, course_id, campus_id, teacher_id, name, status, capacity, schedule_text, start_date)
select id, '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000100', campus_id, teacher_id, format('Resource Class %s', teacher_no), 'running', 20, 'mock', current_date - interval '2 years'
from resource_groups;

insert into class_group_capacity_history (organization_id, class_group_id, capacity, effective_from)
select '20000000-0000-4000-8000-000000000001'::uuid, id, 20, current_date - interval '2 years' from resource_groups
union all
select '20000000-0000-4000-8000-000000000001'::uuid, id, 24, current_date - interval '1 year' from resource_groups;

insert into lesson (organization_id, class_group_id, teacher_id, campus_id, room, starts_at, ends_at, status)
select
	'20000000-0000-4000-8000-000000000001', g.id, g.teacher_id, g.campus_id, 'Mock Room',
	(current_date - interval '2 years' + make_interval(days => day_no, hours => 9)),
	(current_date - interval '2 years' + make_interval(days => day_no, hours => 10)),
	case when day_no < 700 then 'completed'::lesson_status else 'scheduled'::lesson_status end
from resource_groups g cross join generate_series(0, 729) as day_no;

analyze;
commit;

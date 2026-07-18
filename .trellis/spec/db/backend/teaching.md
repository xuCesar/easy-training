# 教务主数据与排课契约

## 1. Scope / Trigger

适用于课程、教师、班级和课次的读取与写入。教学领域以 `course -> classGroup -> lesson` 为稳定主链，`lesson` 是唯一排课事实来源，`classGroup.scheduleText` 仅用于兼容展示。

## 2. Signatures

- 课程：`list/create/update/setActiveCourseRecord`，机构级目录，仅 `owner/admin` 可写。
- 教师：`list/create/updateTeacherRecord`，教师必须通过 `teacherCampus` 归属一个或多个启用校区。
- 班级：`list/create/updateClassGroupRecord`，属于单一校区、课程和主讲教师。
- 课次：`list/create/cancelLessonRecord`；创建输入 `{ classGroupId, room, startsAt, endsAt }`，取消输入 `{ id, reason? }`。

## 3. Contracts

- 所有教学写入在机构 advisory lock 内调用 `getCurrentWriteCampusAccess`，重新读取成员角色与校区范围；不使用 API middleware 的授权快照作为最终写入依据。
- 课程停用会阻断新班级、课次和报名转化，但不删除历史班级、报名或课次。
- 课程单次时长仅可在尚无报名和课次时修改；允许已有空班级，已有报名（含未分班报名）或任一课次时必须创建新课程版本。
- 新建班级要求课程和校区启用、教师归属目标校区、容量为正；已有报名或课次时禁止更换课程或校区，容量不能小于报名数。
- 课次继承班级的校区和主讲教师，限 `recruiting/running` 班级；时长必须等于课程标准时长。时间区间为半开区间 `[startsAt, endsAt)`，以 `Asia/Shanghai` 解释和展示。
- 冲突判断仅针对 `scheduled` 课次：同教师或同机构内同校区、规范化教室，满足 `existing.startsAt < next.endsAt && existing.endsAt > next.startsAt` 即冲突。
- 取消仅允许 `scheduled -> cancelled`，写入 `cancelledAt`、`cancelledByUserId` 和可选原因，不改动报名、账单、考勤或课消。

## 4. Validation & Error Matrix

| 条件 | 领域错误 | API 语义 |
| --- | --- | --- |
| 校区越权或成员被撤销 | `CAMPUS_OUT_OF_SCOPE` / `MEMBER_FORBIDDEN` | `FORBIDDEN` |
| 校区、课程停用 | `CAMPUS_INACTIVE` / `COURSE_INACTIVE` | `CONFLICT` |
| 已有报名或课次仍修改课程单次时长 | `COURSE_DURATION_LOCKED` | `CONFLICT` |
| 教师未归属校区 | `TEACHER_CAMPUS_MISMATCH` | `CONFLICT` |
| 班级已有依赖仍更换课程或校区 | `CLASS_LOCKED` | `CONFLICT` |
| 时间非法、时长不符、资源重叠 | `LESSON_TIME_INVALID` / `LESSON_DURATION_INVALID` / `LESSON_CONFLICT` | `BAD_REQUEST` / `CONFLICT` |
| 重复取消或不可排课状态 | `LESSON_NOT_CANCELLABLE` / `CLASS_NOT_SCHEDULABLE` | `CONFLICT` |

## 5. Good / Base / Bad Cases

- Good：校区负责人在已授权、启用校区为 `running` 班级排入与课程时长一致的课次；相邻时间的两节课允许。
- Base：已取消课次仍可查询并保留资源与审计字段，但不参与新的冲突判断。
- Bad：在客户端提交教师、校区或机构 ID 后直接信任其关联关系；或用 `scheduleText` 作为第二套可编辑排程来源。

## 6. Tests Required

- PostgreSQL 集成测试覆盖机构隔离、停用课程、停用/越权校区、教师校区归属、容量边界和报名转化候选过滤。
- 覆盖同教师与同校区教室冲突、相邻时间、取消后重排、重复取消及并发创建。
- 覆盖权限在读取快照后被撤销时，事务内重新校验仍会拒绝写入。

## 7. Wrong vs Correct

### Wrong

```ts
await tx.insert(lesson).values(values);
return db.select().from(lesson); // 全局连接看不到当前事务尚未提交的写入
```

### Correct

```ts
const lessonId = await db.transaction(async (tx) => {
  const [created] = await tx.insert(lesson).values(values).returning({ id: lesson.id });
  return created.id;
});
return getLessonAfterCommit(lessonId);
```

写入返回需要关联读取时，事务内使用同一个 `tx` 完成查询，或先提交后以已授权资源 ID 读取；不要混用全局 `db` 连接。

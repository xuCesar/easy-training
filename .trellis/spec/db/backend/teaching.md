# 教务主数据与排课契约

## 1. Scope / Trigger

适用于课程、教师、班级、报名归属和课次的读取与写入。教学领域以 `course -> classGroup -> lesson` 为稳定主链，`lesson` 是唯一排课事实来源，`classGroup.scheduleText` 仅用于兼容展示。

## 2. Signatures

- 课程：`list/create/update/setActiveCourseRecord`，机构级目录，仅 `owner/admin` 可写。
- 教师：`list/create/updateTeacherRecord`，教师必须通过 `teacherCampus` 归属一个或多个启用校区。
- 班级：`list/create/updateClassGroupRecord`，属于单一校区、课程和主讲教师。
- 课次：`list/create/cancelLessonRecord`；新建输入 `{ classGroupId, roomId, room, startsAt, endsAt }`，其中 `roomId` 是必须校验的资源标识，`room` 仅为兼容字段并由服务端以教室名称覆盖为历史快照；取消输入 `{ id, reason? }`。
- 入班：`listClassEnrollmentRecords({ classGroupId })` 与 `assignEnrollmentClassRecord({ enrollmentId, classGroupId | null })`；仍使用 `enrollment.classGroupId`，不维护平行成员表。
- 点名结课：`getLessonAttendanceRecord({ id })` 返回当前名单；`completeLessonRecord({ id, attendance })` 以完整名单完成考勤、消课和课次结课。

## 3. Contracts

- 所有教学写入在机构 advisory lock 内调用 `getCurrentWriteCampusAccess`，重新读取成员角色与校区范围；不使用 API middleware 的授权快照作为最终写入依据。
- 课程停用会阻断新班级、课次和报名转化，但不删除历史班级、报名或课次。
- 课程单次时长仅可在尚无报名和课次时修改；允许已有空班级，已有报名（含未分班报名）或任一课次时必须创建新课程版本。
- 新建班级要求课程和校区启用、教师归属目标校区、容量为正，且仓储/API 固定写为 `recruiting`；已有报名或课次时禁止更换课程或校区，容量不能小于 active 报名数。
- 班级状态唯一允许 `recruiting → running`、`running → paused | completed`、`paused → running | completed`；`completed` 只能保持完成态，不能重新开启。首次进入 `completed` 前不得存在 `scheduled` 课次。
- 课次继承班级的校区和主讲教师，限 `recruiting/running` 班级；时长必须等于课程标准时长。时间区间为半开区间 `[startsAt, endsAt)`，以 `Asia/Shanghai` 解释和展示。
- 冲突判断仅针对 `scheduled` 课次：同教师或同机构内同校区、同 `roomId` 时，满足 `existing.startsAt < next.endsAt && existing.endsAt > next.startsAt` 即冲突；为兼容历史数据，`roomId = null` 的既有课次继续以规范化 `room` 快照参与教室冲突判断。
- 取消仅允许 `scheduled -> cancelled`，写入 `cancelledAt`、`cancelledByUserId` 和可选原因，不改动报名、账单、考勤或课消。
- 入班只允许 `enrollment.status = active`、同机构、同课程、学员同校区且 `recruiting/running` 的未满班级；移出班级传 `classGroupId: null`，不改动金额、购买课次或剩余课时。同一学员不得在同一班级保留两条 active 报名。
- 成员列表、容量、报名转化班级候选/入班校验、点名名单和结课消课均只使用 active 报名；这同时保护历史遗留的 `transferred` 记录，即使其错误保留了 `classGroupId` 也不得占用席位、阻止同学员重新报名或参与考勤、扣课。
- 结课只允许 `scheduled -> completed`。提交名单必须与锁定班级后的当前 active 报名全集完全一致；`present/late` 各扣 1 课时，`absent/leave` 不扣。`lessonConsumption` 以 `(enrollmentId, lessonId)` 唯一账本记录扣减前后余额、考勤状态与操作人。
- 成功结课在同一事务写入 `lesson_completed` 审计，实体为 lesson UUID，必须携带 lesson 的 campusId；after 仅记录 classGroupId 与 activeEnrollmentCount，不能写入名单或备注。
- 结课与入班都先锁定目标班级，再锁定报名，防止与报名转化并发时遗漏成员或形成锁顺序死锁。余额不足、名单变化或任一写入失败时整笔事务回滚。

## 4. Validation & Error Matrix

| 条件 | 领域错误 | API 语义 |
| --- | --- | --- |
| 校区越权或成员被撤销 | `CAMPUS_OUT_OF_SCOPE` / `MEMBER_FORBIDDEN` | `FORBIDDEN` |
| 校区、课程停用 | `CAMPUS_INACTIVE` / `COURSE_INACTIVE` | `CONFLICT` |
| 已有报名或课次仍修改课程单次时长 | `COURSE_DURATION_LOCKED` | `CONFLICT` |
| 教师未归属校区 | `TEACHER_CAMPUS_MISMATCH` | `CONFLICT` |
| 班级已有依赖仍更换课程或校区 | `CLASS_LOCKED` | `CONFLICT` |
| 非法班级状态跃迁或仍有待上课次时结课 | `CLASS_STATUS_TRANSITION_INVALID` / `CLASS_HAS_SCHEDULED_LESSONS` | `CONFLICT` |
| 已转课或其他非 active 报名调整班级 | `ENROLLMENT_NOT_ACTIVE` | `CONFLICT` |
| 入班跨课程、跨校区、满班或重复学员 | `CLASS_COURSE_MISMATCH` / `CLASS_CAMPUS_MISMATCH` / `CLASS_FULL` / `CLASS_STUDENT_DUPLICATE` | `CONFLICT` |
| 时间非法、时长不符、资源重叠 | `LESSON_TIME_INVALID` / `LESSON_DURATION_INVALID` / `LESSON_CONFLICT` | `BAD_REQUEST` / `CONFLICT` |
| 重复取消或不可排课状态 | `LESSON_NOT_CANCELLABLE` / `CLASS_NOT_SCHEDULABLE` | `CONFLICT` |
| 已完成/取消课次、不完整名单或重复结课 | `LESSON_COMPLETION_INVALID` | `CONFLICT` |
| 到课/迟到学员余额不足 | `LESSON_CONSUMPTION_INSUFFICIENT` | `CONFLICT` |

## 5. Good / Base / Bad Cases

- Good：校区负责人在已授权、启用校区为 `running` 班级排入与课程时长一致的课次；相邻时间的两节课允许。
- Base：已取消课次仍可查询并保留资源与审计字段，但不参与新的冲突判断。
- Base：已完成课次可读取考勤和消课历史，但不可修改、重复点名或取消；已有空班级可继续调整课程时长，已有报名或课次则不可。
- Bad：在客户端提交教师、校区或机构 ID 后直接信任其关联关系；或用 `scheduleText` 作为第二套可编辑排程来源。
- Bad：在前端逐个保存考勤再扣余额，或直接更新 `remainingLessons` 而不写唯一流水；这会留下部分成功和重复扣减路径。

## 6. Tests Required

- PostgreSQL 集成测试覆盖机构隔离、停用课程、停用/越权校区、教师校区归属、容量边界和报名转化候选过滤。
- 覆盖同教师与同校区教室冲突、相邻时间、取消后重排、重复取消及并发创建。
- 覆盖权限在读取快照后被撤销时，事务内重新校验仍会拒绝写入。
- 覆盖班级状态图、完成前处理待上课次，以及入班的课程/校区/容量/重复学员限制与移出班级；已转课或历史非 active 报名不得出现在成员/点名/消课路径。结课需断言考勤、余额和账本同事务写入，余额不足全回滚，重复/并发请求最多一方成功。
- 结课测试还需断言成功/并发重放至多产生一条 `lesson_completed`，余额不足或名单非法时不写审计。
- 有 `lessonConsumption` 时，测试清理先删流水，再删报名与课次；生产删除策略应显式评估账本保留需求。

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

### Wrong

```ts
await tx.update(enrollment).set({ remainingLessons: sql`${enrollment.remainingLessons} - 1` });
await tx.update(lesson).set({ status: "completed" });
```

没有锁定班级和完整名单，也没有幂等账本；并发入班、重试或余额不足会造成账实不一致。

### Correct

```ts
await tx.select({ id: classGroup.id }).from(classGroup).where(...).for("update");
// 锁定后的完整名单预检余额，再写 attendance、lessonConsumption、余额与 completed 状态。
```

目标班级锁必须先于报名锁取得，并以 `(enrollmentId, lessonId)` 唯一流水作为重复扣减的数据库保护。

## 场景：周期规则、未来课次变更与教师工作台

### 1. Scope / Trigger

- 适用于周期规则、生成/同步/停用、任意未来课次批量调整、教师账号绑定和教师点名草稿。
- `lesson` 仍是唯一课次事实；`classGroup.scheduleText` 仅由当前有效规则派生为兼容摘要，绝不参与冲突判断或写入排课事实。

### 2. Signatures

- 规则：`list/create/previewGenerate/generate/previewUpdate/update/previewDeactivate/deactivate/deleteScheduleRuleRecord`。
- 未来课次：`previewBulkLessonUpdateRecord`、`bulkUpdateLessonsRecord`；提交项必须带 `id`、`expectedVersion`、`startsAt`、`teacherId` 与 `room`。
- 教师工作台：`getTeacherWorkspaceRecord`、`getTeacherLessonAttendanceRecord`、`saveLessonAttendanceDraftRecord`、`completeLessonRecord`。
- `lesson_schedule_rule` 使用 `kind=weekly`、`intervalWeeks=1` 作为首期实现；`lesson_schedule_batch` 以 `(organizationId, requestId)` 保存请求指纹和受影响课次。
- 规则列表返回 `hasGeneratedLessons`；Web 仅在其为 `false` 时展示删除操作，服务端仍以关联 `lesson` 查询作为最终保护。

### 3. Contracts

- 所有周期候选按 `Asia/Shanghai` 的逻辑发生日展开，结束时间始终由课程标准时长派生；预览只允许覆盖日期/开始时间与教室。
- 生成、规则同步和批量调整均须在机构事务锁内重新校验成员范围、班级/课程/教师校区、资源冲突、规则 revision 与课次 version。预览不是资源锁。
- 同一班级的有效规则若 `kind`、间隔、星期集合、开始时间、教室和有效日期范围完全相同，创建必须返回 `SCHEDULE_RULE_DUPLICATE`；停用后的历史规则不阻止创建新的同定义规则。
- 创建或修改规则时，还必须与同班级其他启用规则比较未来有效日期交集、共同上课星期及课程标准时长；任一未来时段重叠即返回 `SCHEDULE_RULE_CONFLICT`。同班级共享主讲教师，因此即使教室不同也不能用重叠规则排课。
- 规则从未关联任何 `lesson` 时允许删除；删除需同时清理该规则的无课次批次记录并写 `schedule_rule_deleted` 审计。只要曾生成过任一课次（包括已取消/已完成），则返回 `SCHEDULE_RULE_HAS_GENERATED_LESSONS`，只能保留或停用规则。
- 仅 `status=scheduled && startsAt > transactionNow` 的课次可被规则同步、停用取消或自由批量调整；完成、取消及已开始课次永久冻结。
- 批量调整改写规则来源课次时设置 `isScheduleOverride=true`；规则同步保留该例外，除非请求显式选择重新套用规则。
- 点名草稿从 `startsAt - 30 minutes` 开放，不产生 `lessonConsumption`；最终结课仅在 `now >= endsAt`，锁定当前 active 报名全集后写考勤、课消、教学小结、完成元数据和审计。
- 教师读取/写入必须同时匹配当前机构的 `teacher` 成员角色、`teacher.userId` 显式绑定与 `lesson.teacherId`，不得凭用户 ID 查询机构级教务数据。

### 4. Validation & Error Matrix

| 条件 | 领域错误 |
| --- | --- |
| 规则已停用、revision 陈旧或候选集合被篡改 | `SCHEDULE_RULE_INACTIVE` / `SCHEDULE_RULE_VERSION_CONFLICT` / `SCHEDULE_CANDIDATE_INVALID` |
| 同一班级重复创建完全相同的有效规则 | `SCHEDULE_RULE_DUPLICATE` |
| 新建或修改后与同班级其他启用规则发生未来时段重叠 | `SCHEDULE_RULE_CONFLICT` |
| 删除曾生成过任一课次的规则 | `SCHEDULE_RULE_HAS_GENERATED_LESSONS` |
| 重复 requestId 的载荷不同 | `IDEMPOTENCY_CONFLICT` |
| 未来条件、状态或 version 不再满足 | `LESSON_BULK_UPDATE_INVALID` |
| 教师/教室冲突或教师不归属校区 | `LESSON_CONFLICT` / `TEACHER_CAMPUS_MISMATCH` |
| 停用时选择取消却没有统一原因 | `INVALID_INPUT` |
| 未绑定教师、非本人课次、草稿过早或最终结课过早 | `TEACHER_BINDING_NOT_FOUND` / `TEACHER_LESSON_FORBIDDEN` / `ATTENDANCE_DRAFT_NOT_AVAILABLE` / `LESSON_COMPLETION_NOT_AVAILABLE` |

### 5. Good / Base / Bad Cases

- Good：规则预览无冲突后以相同 requestId 原子生成；重放直接返回原课次 ID，不新增课次或审计。
- Good：创建请求成功后才重置表单；后续列表刷新失败要明确提示“已创建，刷新失败”，不能把已提交成功误报为创建失败。
- Base：停用规则但不取消未来课次时，只停止后续生成；这些已生成的未来课次照常保留。
- Base：规则修改使某个逻辑发生日不再匹配时，该未来课次保留为人工例外，而不是静默删除或改写。
- Bad：前端根据本地时钟判断“未来”后逐节提交；或让教师角色复用机构级教务管理写权限。

### 6. Tests Required

- PostgreSQL 集成测试覆盖多星期展开、候选内/外冲突、提交候选完整性、同 requestId 重放与不同载荷冲突。
- 覆盖连续或并发提交相同有效规则时只保留首条，停用后允许重新创建。
- 覆盖新建和修改规则时：日期范围、星期和时段均相交会拒绝；只交日期范围或只交星期、以及时段相邻时允许。
- 覆盖未生成课次规则可删除、删除后规则批次被清理并写审计；曾生成课次的规则删除失败且规则/课次/审计不被改写。
- 覆盖规则停用的保留和批量取消分支、统一取消原因、规则同步的 revision/version 竞争，以及完成/取消/已开始课次不会被改写。
- 覆盖跨机构/非 teacher/重复教师绑定、教师仅能操作本人课次、草稿不产生课消、结束时间前不能结课、名单变化和余额不足完整回滚。

### 7. Wrong vs Correct

#### Wrong

```ts
// 预览时检查过，就直接按客户端课次 ID 和本地时间逐条更新。
for (const item of input.items) await updateLesson(item);
```

#### Correct

```ts
const transactionNow = new Date();
const preview = await buildBulkLessonUpdatePreview(tx, {
  ...input,
  transactionNow,
});
// 再以相同 transactionNow、status、version 与资源冲突条件原子更新全部课次。
```

## 场景：补课、班级停复课与教室资源

### 1. Scope / Trigger

- 适用于教室资源 CRUD/启停、班级专用停复课、补课安排，以及单次排课、周期规则、规则生成/同步、批量调课和入班的容量联动。
- `lesson.roomId`、`lesson_schedule_rule.roomId` 为 nullable 仅用于历史兼容；所有新增排课写入口必须提交启用教室的 `roomId`，不得以自由文本绕过资源状态、校区或容量校验。

### 2. Signatures

- 教室：`listClassroomRecords`、`createClassroomRecord`、`updateClassroomRecord`、`setClassroomActiveRecord`；创建输入 `{ campusId, name, capacity }`，更新输入 `{ id, name, capacity }`，启停输入 `{ id, isActive }`。
- 停复课：`pauseClassGroupRecord({ id, reason, futureLessonPolicy: "keep" | "cancel", requestId })`、`resumeClassGroupRecord({ id, reason, requestId })`。
- 补课：`listMakeupLessonRecords`、`createMakeupLessonRecord({ sourceLessonId, sourceEnrollmentId, targetLessonId, requestId })`、`cancelMakeupLessonRecord({ id })`。
- 排课资源：`createLessonRecord`、规则创建/更新/生成/同步与 `bulkUpdateLessonsRecord` 必须携带 `roomId`；服务端读取教室名称并写入 `room` 快照，不能信任客户端自由文本。
- 数据库：`classroom` 以 `(organizationId, campusId, nameNormalized)` 唯一；`makeupLesson` 以 `(organizationId, requestId)` 幂等，并用部分唯一索引保证同一来源报名/来源课次最多一个 `scheduled` 安排。

### 3. Contracts

- 教室写入统一采用“机构 advisory lock / 当前权限重验 → classroom 行锁”的顺序。更新、启停不得先锁教室再获取机构锁，避免与排课、补课或其他教室写入形成锁顺序反转。
- 教室容量占用人数为目标班级不同 `studentId` 的 active 报名人数，加目标课次不同学员的 `scheduled` 补课人数；排课、规则生成/同步、批量调课、补课创建都使用该口径。
- 教室降容必须检查该教室全部未来 `scheduled` 课次；任一课次按上述口径超容时整笔更新失败。停用教室时，只要仍有未来 `scheduled` 引用就拒绝，已完成、已取消或已开始课次不阻止停用。
- 入班除班级容量外，还必须检查目标班级全部未来、已绑定 `roomId` 的 `scheduled` 课次；新增学员会造成任一课次超容时拒绝。若该学员已作为 `scheduled` 补课成员存在于目标班未来课次，也必须拒绝入班，防止点名名单重复。
- 停课仅允许 `running -> paused`，必须携带原因、处理策略和 requestId。`keep` 不改写未来课次；`cancel` 在同一事务取消提交时仍未开始的 `scheduled` 课次，并把对应 scheduled 补课标为 `needs_reschedule`。复课仅允许 `paused -> running`，不自动恢复或生成课次。
- 暂停班级冻结所有未来变更入口：单次排课、规则创建/更新/预览停用/停用/删除、规则生成/同步、批量调课、点名和结课都必须由服务端拒绝；已完成、已取消及已开始课次保持历史事实不变。
- 补课不修改 `enrollment.classGroupId`、来源课次、来源考勤或来源课消。来源必须是 active 报名在已完成来源课次中的 `absent/leave`；目标必须为同课程、同校区、未开始的 `scheduled` 课次，且学员不是目标班 active 成员。
- 目标课次名单合并目标班 active 报名和 scheduled 补课成员，并按学员去重。补课成员 `present/late` 写唯一课消并将安排置为 `fulfilled`；`absent/leave` 不扣课并置为 `needs_reschedule`，之后可重新安排。
- 同一来源报名与来源课次在 `scheduled` 时只能有一条有效安排；`cancelled` 或 `needs_reschedule` 可重排，但一旦任一安排已 `fulfilled`，该来源事实已经完成课消，后续创建必须返回 `MAKEUP_LESSON_DUPLICATE`。取消补课也只允许目标课次仍为未开始的 `scheduled` 状态。
- 停复课与补课的幂等重放在返回既有结果前，必须锁定关联班级或目标课次并重新执行校区写权限校验；不得仅凭机构内 requestId 返回跨校区数据。

### 4. Validation & Error Matrix

| 条件 | 领域错误 | API 语义 |
| --- | --- | --- |
| 教室不存在、跨校区或已停用 | `CLASSROOM_NOT_FOUND` / `CAMPUS_OUT_OF_SCOPE` / `CLASSROOM_INACTIVE` 或排课域对应错误 | `NOT_FOUND` / `FORBIDDEN` / `CONFLICT` |
| 同校区规范化同名教室 | `CLASSROOM_DUPLICATE` | `CONFLICT` |
| 教室仍有未来课次时停用 | `CLASSROOM_HAS_FUTURE_LESSONS` | `CONFLICT` |
| 降容、排课、调课、补课或入班造成未来课次超容 | `CLASS_FULL` 或 `INVALID_INPUT`（教室仓储降容） | `CONFLICT` / `BAD_REQUEST` |
| 非 running 班级停课、非 paused 班级复课 | `CLASS_NOT_PAUSABLE` / `CLASS_NOT_RESUMABLE` | `CONFLICT` |
| 暂停班级排课、调课、点名或结课 | `CLASS_NOT_SCHEDULABLE` / `LESSON_BULK_UPDATE_INVALID` / `CLASS_ATTENDANCE_LOCKED` | `CONFLICT` |
| 补课来源、目标、课程、校区、状态或名单不合法 | `MAKEUP_LESSON_INVALID` | `CONFLICT` |
| 同一来源已有有效补课或目标课次重复学员 | `MAKEUP_LESSON_DUPLICATE` / `CLASS_STUDENT_DUPLICATE` | `CONFLICT` |
| 已完成来源再次安排，或取消已开始/非待上目标的补课 | `MAKEUP_LESSON_DUPLICATE` / `MAKEUP_LESSON_INVALID` | `CONFLICT` |
| 相同 requestId 的载荷不同 | `IDEMPOTENCY_CONFLICT` | `CONFLICT` |

### 5. Good / Base / Bad Cases

- Good：缺勤学员保持原班级归属，被安排到同课程、同校区且容量充足的未来课次；目标点名显示该学员，到课后只扣来源报名一次课时。
- Good：班级停课选择取消未来课次时，班级状态、未来课次和对应补课安排在一个事务内一致更新；相同 requestId 重放不新增审计。
- Base：历史课次只有 `room` 文本、`roomId = null` 时仍可展示和参与兼容冲突判断，但不追溯执行启停与容量阻断。
- Base：教室更名只影响后续排课快照，不改写历史 `lesson.room`；复课也不恢复此前取消的课次。
- Bad：允许客户端仅传 `room: "A201"` 新增课次，或用班级人数代替“active 班级学员 + scheduled 补课学员”检查容量。
- Bad：为补课修改学员班级归属，或在班级暂停后仅隐藏前端按钮而不阻断规则和课次写接口。

### 6. Tests Required

- PostgreSQL 集成测试覆盖教室机构/校区权限、同名唯一、启停、未来引用保护，以及降容时 active 报名与 scheduled 补课共同计入容量。
- 覆盖单次排课、周期规则创建/生成/同步和批量调课拒绝缺失、跨校区或停用 `roomId`，并断言 `room` 快照来自资源名称；历史文本课次保持可读。
- 覆盖入班对全部未来课次的容量保护，以及学员已有目标班未来补课时拒绝入班。
- 覆盖停课 keep/cancel、复课、幂等重放/载荷冲突、历史课次冻结，以及暂停期间规则变更、调课、点名和结课均被拒绝。
- 覆盖补课资格、课程/校区一致性、目标容量、并发唯一、取消、目标课次取消后重排，以及结课后 `fulfilled/needs_reschedule`、课消幂等和来源事实不变。
- 覆盖 `fulfilled` 来源不可再次安排、已开始目标不可取消，以及跨校区权限不足时不能通过相同 requestId 重放读取既有停复课或补课结果。
- 并发测试需验证教室写入与排课/补课使用一致锁顺序，不出现死锁或越过更新后的容量、启停状态。

### 7. Wrong vs Correct

#### Wrong

```ts
await tx.insert(lesson).values({ room: input.room, roomId: null });
const attendeeCount = await countClassEnrollments(classGroupId);
```

自由文本绕过了教室启停、校区与容量约束，且忽略目标课次已有补课学员。

#### Correct

```ts
const room = await resolveActiveClassroom(tx, {
  organizationId,
  campusId,
  roomId: input.roomId,
  classGroupId,
  extraAttendeeCount: scheduledMakeupCount,
});
await tx.insert(lesson).values({ roomId: room.id, room: room.name });
```

`roomId` 是新写入的资源事实，`room` 只保存当时名称快照；容量检查必须显式带入目标课次有效补课人数。

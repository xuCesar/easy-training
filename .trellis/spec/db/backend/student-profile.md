# 学员档案并发更新契约

## 1. Scope / Trigger

学员档案更新会完整替换联系人和标签，并回写主要联系人的 guardian 兼容字段。此类聚合写入必须用详情版本保护，避免两个编辑者静默互相覆盖。

## 2. Signatures

```ts
type UpdateStudentInput = {
  id: string;
  expectedUpdatedAt: string;
  data: StudentProfilePayload;
};

updateStudentRecord({
  organizationId,
  userId,
  campusAccess,
  id,
  expectedUpdatedAt: Date,
  data,
});
```

## 3. Contracts

- `expectedUpdatedAt` 是详情 `updatedAt` 的 ISO 8601 值，必填且位于 `data` 外。
- repository 在同一 PostgreSQL 事务中按机构与学员 ID 锁定学员行，先校验权限，再比较版本，最后才替换联系人或标签。
- 成功写入用 `greatest(clock_timestamp(), updated_at + interval '1 millisecond')` 推进版本，确保连续成功更新的令牌不同。
- 版本冲突映射为 ORPC `CONFLICT`，并携带 `data: { reason: "STUDENT_VERSION_CONFLICT" }`。前端只能以该结构化标记判断可刷新冲突。

## 4. Validation & Error Matrix

| 条件 | DB 错误 | API 响应 |
| --- | --- | --- |
| 学员不存在 | `STUDENT_NOT_FOUND` | `NOT_FOUND` |
| 无校区访问权限 | `CAMPUS_OUT_OF_SCOPE` | `FORBIDDEN` |
| 版本不一致 | `STUDENT_VERSION_CONFLICT` | `CONFLICT` + 专用 reason |
| 联系人不恰有一个主要联系人 | `CONTACT_INVARIANT` | `BAD_REQUEST` |

## 5. Good / Base / Bad Cases

- Good：编辑器提交当前详情版本，联系人、标签和 guardian 在一个事务中更新。
- Base：刷新详情只更新下一次提交的版本令牌，保留用户尚未保存的草稿，且不自动重试。
- Bad：把版本字段设为 optional，或仅凭通用 `CONFLICT`/中文错误文案判断版本冲突。

## 6. Tests Required

- 两个相同旧版本的并发写入必须断言恰好一个成功、另一个为 `STUDENT_VERSION_CONFLICT`。
- 覆盖联系人新增、主要联系人变化、标签替换；失败方不得留下任何部分写入，guardian 必须与成功方主要联系人一致。
- 路由客户端断言 `CONFLICT` 与 `error.data.reason`，不能只断言 HTTP 类别。

## 7. Wrong vs Correct

### Wrong

```ts
if (error.code === "CONFLICT") showRefreshPrompt();
```

### Correct

```ts
if (
  error.code === "CONFLICT" &&
  error.data?.reason === "STUDENT_VERSION_CONFLICT"
) {
  showRefreshPrompt();
}
```

## Scenario: 同机构疑似重复与人工合并

### 1. Scope / Trigger

当创建或编辑联系人、独立报名，或 owner/admin 合并两个同机构学员档案时使用。手机号仅用于提示；合并是不可逆的来源映射，不得自动叠加同课程权益。

### 2. Signatures

- `findDuplicateStudentCandidates({ organizationId, campusAccess, phone, excludeStudentId? })`
- `getStudentMergePreviewRecord({ organizationId, userId, sourceStudentId, targetStudentId })`
- `mergeStudentRecords({ sourceStudentId, targetStudentId, expectedSourceUpdatedAt, expectedTargetUpdatedAt, requestId, fieldSources })`
- API：`training.students.duplicateCandidates`、`mergePreview`、`merge`。

### 3. Contracts

- 标准化仅移除空格、括号、横线和 `+86`/`86` 前缀；仅同机构比较 guardian 与全部联系人，结果脱敏手机号。
- 合并只限 owner/admin，且事务内重读双档案校区权限；`fieldSources` 必须显式指定姓名、校区、出生日期、状态和主要联系人。
- 联系人按标准化手机号去重、标签取并集；可安全迁移报名、账单、考勤和报名登记。来源档案写入 `mergedIntoStudentId/mergedAt` 后不得再编辑或报名。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 跨机构、非 owner/admin、任一校区越权 | `STUDENT_NOT_FOUND` / `MEMBER_FORBIDDEN` / `CAMPUS_OUT_OF_SCOPE` |
| 同一来源/主档案、来源已合并 | `STUDENT_MERGE_SAME_RECORD` / `STUDENT_ALREADY_MERGED` |
| 任一详情版本陈旧 | `STUDENT_VERSION_CONFLICT` |
| 同课程 `active/frozen` 报名，或同课次重复考勤 | `STUDENT_MERGE_ACTIVE_COURSE_ENROLLMENT` / `STUDENT_MERGE_ATTENDANCE_CONFLICT` |
| 选择的档案校区不覆盖有效班级 | `STUDENT_MERGE_CAMPUS_ENROLLMENT_CONFLICT` |
| 相同 requestId 载荷不同 | `IDEMPOTENCY_CONFLICT` |

### 5. Good / Base / Bad Cases

- Good：owner 选择主档案字段和联系人，事务迁移安全关联，写一条 `student_merged` 审计，重放不重复写入。
- Base：跨校区同手机号仍可提示；只有合并提交时才要求操作者同时拥有两校区写权限。
- Bad：以姓名/生日自动合并，或删除来源档案、静默合并同课程有效报名。

### 6. Tests Required

- 覆盖 `+86` 格式差异、跨校区命中、跨机构隔离和来源档案排除。
- 覆盖字段选择、联系人/标签合并、来源写入拒绝、业务关联迁移、审计、版本与 requestId 重放。
- 覆盖同课程有效报名、考勤唯一冲突、校区与权限失败均无部分写入。

### 7. Wrong vs Correct

#### Wrong

```ts
await db.update(student).set({ mergedIntoStudentId: targetId });
```

这会遗留联系人、报名和考勤归属，也没有并发、权限或审计边界。

#### Correct

```ts
await db.transaction(async (tx) => {
  const preview = await loadMergePreviewInTransaction(tx, input);
  assertNoMergeConflicts(preview);
  await moveSafeAssociations(tx, preview);
	await writeOrganizationAuditEvent(tx, { action: "student_merged", ...audit });
});
```

## Scenario: 学员业务时间线

### 1. Scope / Trigger

- 适用于在学员详情统一追溯报名、报名生命周期、账单、收款、续费、转课、退款、考勤、课消和学员状态变化。
- 时间线是既有业务事实的只读投影，不建立资金、课时或报名镜像，也不以当前状态反推或覆盖历史。

### 2. Signatures

- DB：`listStudentTimelineRecords({ organizationId, campusAccess, studentId, includeFinancial, cursor?, pageSize })`。
- API：`training.students.timeline({ studentId, cursor?, pageSize })`，每页 1～50 项，默认 20 项。
- 响应：`{ items, nextCursor }`；事件拥有稳定 `id`、`kind`、`occurredAt`、可空 `recordedAt/actorName`、受控摘要字段，以及 `source: none | invoice | lesson` 判别联合。
- 状态写入：`updateStudentRecord` 仅在 `beforeStatus !== afterStatus` 时，于同一事务追加 `studentStatusEvent`；旧数据不回填。

### 3. Contracts

- 聚合来源的唯一事实仍是 enrollment、lifecycle event、invoice、payment、renewal、transfer、refund、attendance、lesson consumption 和 student status event；取消、退款等反向动作追加新事件，不改写原事件。
- 考勤和课消的 `occurredAt` 使用课次 `startsAt`，实际登记/课消时间放入 `recordedAt`。其余事件使用领域发生时间。
- 全局顺序固定为 `occurredAt DESC, kindRank DESC, sourceId DESC`；游标编码相同三元组，下一页使用严格小于比较。新增事件种类时必须分配稳定且唯一意图明确的 `kindRank`。
- DB 先按 `organizationId + studentId` 验证学员，再校验学员校区范围。API 使用 `studentProcedure`：teacher/finance 不可访问；consultant 可见招生与教学事件，但账单、收款、续费、转课、退款全部不返回，报名事件的金额和账单来源也必须置空。
- `invoiceId` 和 `lessonId` 只用于受控导航。`/finance?invoiceId=...` 与 `/academic?tab=lessons&lessonId=...` 的目标查询继续执行自身角色、机构和校区鉴权，URL 参数不能替代授权。
- Web 必须覆盖初始加载、空态、错误重试、加载更多和移动端单列布局。深链接直接使用 `Link`，并以 `buttonVariants` 复用按钮外观；不要把 `Link` 放入 Base UI `Button` 的 `render` 插槽，否则会产生原生按钮/锚点语义冲突。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 学员不属于当前机构 | `STUDENT_NOT_FOUND` → API `NOT_FOUND` |
| 学员校区不在当前范围 | `CAMPUS_OUT_OF_SCOPE` → API `FORBIDDEN` |
| 游标不是受支持的 base64url 三元组 | `INVALID_CURSOR` → API `BAD_REQUEST` |
| consultant 请求时间线 | 服务端剔除全部财务事件和财务来源，不依赖前端隐藏 |
| teacher/finance 调用时间线 | `studentProcedure` 在路由层拒绝 |
| 深链接目标不存在或越权 | 由 finance/academic 目标过程按自身规则拒绝，不泄露跨机构资源 |

### 5. Good / Base / Bad Cases

- Good：补录 7 月 4 日课次的考勤于 7 月 10 日完成；事件排在 7 月 4 日，摘要同时展示实际登记时间 7 月 10 日。
- Good：同一发生时间跨页时，`kindRank + sourceId` 保证事件不重复、不漏失、不随机换位。
- Base：功能上线前的学员没有状态历史，仍展示可验证的报名、财务和教学事实，不伪造“初始状态”事件。
- Bad：把所有事实复制进统一 event 表、按 `createdAt` 排补录考勤，或先返回完整财务事件再让前端隐藏；这些做法会造成事实漂移、历史位置错误或数据泄露。

### 6. Tests Required

- PostgreSQL 集成测试必须让真实 UNION 投影执行，覆盖报名、财务、考勤、课消和状态事件的跨来源排序。
- 以小页长遍历全部页，断言稳定 ID 无重复、无遗漏；覆盖同一时间不同 kindRank，以及同类事件按 sourceId 的确定顺序。
- 断言考勤/课消 `occurredAt = lesson.startsAt`、`recordedAt` 保留实际写入时间。
- 状态实际改变写一条事件，状态不变的资料更新不写事件；旧学员不要求回填。
- consultant 响应不得含 invoice/payment/renewal/transfer/refund，报名金额和 invoice source 必须为 null；机构、校区、无效游标和 API ISO 序列化均需断言。
- 浏览器验证账单深链接在当前列表筛选不包含目标时仍能打开详情，课次深链接能切换 tab、滚动并高亮目标；桌面和 390px 窄屏均需检查。

### 7. Wrong vs Correct

#### Wrong

```ts
// 先返回全部事实，再由前端隐藏顾问不应看到的金额和账单。
const items = await listTimeline({ studentId });
return role === "consultant" ? items.map(maskInBrowser) : items;
```

#### Correct

```ts
const items = await listStudentTimelineRecords({
	organizationId,
	campusAccess,
	studentId,
	includeFinancial: ["owner", "admin", "campus_manager"].includes(role),
	cursor,
	pageSize,
});
// DB 投影在返回前已经移除隐藏事件、金额和账单来源。
```

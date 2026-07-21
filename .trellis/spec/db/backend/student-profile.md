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

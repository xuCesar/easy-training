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

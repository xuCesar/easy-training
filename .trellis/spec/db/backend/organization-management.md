# 机构管理契约

## 1. Scope / Trigger

适用于校区、成员范围、邀请，以及所有写入校区归属数据的领域 repository。此类改动同时触及数据库、授权上下文和 API 契约，必须由服务端强制执行，不能仅靠前端筛选。

## 2. Signatures

- 当前机构上下文包含 `campusAccess: { kind: "all" } | { kind: "selected"; campusIds: string[] } | { kind: "none" }`。
- 校区管理写入使用 `{ organizationId, actorUserId, ... }`；成员范围用 `organizationMemberCampus` 替换保存。
- 邀请领取使用 `claimInvitationRecord({ token, userId, userEmail, sessionId })`；只接受 POST body 中的 token。
- 归属校区的写入必须在同一事务内锁定 campus 行，检查机构归属、`CampusAccess` 和 `isActive`。

## 3. Contracts

- `owner` 与 `admin` 固定为 `all`；其他角色在没有指定校区时解析为 `none`。
- `campus.isActive = false` 仅阻断新增或变更，不能过滤历史读取。
- 邀请原始 token 仅在创建或重发响应中返回；数据库只保存 SHA-256 hash，客户端链接使用 `#token=` fragment。
- 所有成员角色、范围、移除及校区启停操作写入 `organizationAuditEvent`，快照保存实际生效的前后字段。

## 4. Validation & Error Matrix

| 条件 | 数据库领域错误 | API 语义 |
| --- | --- | --- |
| 校区不在成员范围 | `CAMPUS_OUT_OF_SCOPE` | `FORBIDDEN` |
| 校区停用后写入 | `CAMPUS_INACTIVE` | `CONFLICT` |
| 移除或降级最后 owner | `LAST_OWNER` | `CONFLICT` |
| 邀请撤销、过期或已领取 | `INVITATION_INVALID` | `CONFLICT` |
| 邀请邮箱不匹配 | `INVITATION_EMAIL_MISMATCH` | `FORBIDDEN` |
| 同一邀请请求重复提交 | `INVITATION_REQUEST_REPLAY` | `CONFLICT`，管理员关闭后重新创建或重发 |

## 5. Good / Base / Bad Cases

- Good: 指定校区成员只能读取和写入其范围内的启用校区；owner 可以读取停用校区历史。
- Base: 全机构成员可以创建不带校区的历史兼容记录，但指定校区成员不能以 `null` 校区绕过范围。
- Bad: 只校验请求中的新 `campusId`，允许停用校区既有线索继续跟进、转报名或收款。

## 6. Tests Required

- PostgreSQL 集成测试覆盖跨机构范围拒绝、停用校区新建与既有业务写入拒绝、历史读取保留。
- 覆盖最后 owner 并发移除或降级后仍保留一位 owner。
- 覆盖邀请重发撤销旧 token、邮箱不匹配、单次领取与 session 当前机构更新。
- 覆盖范围变更后的 dashboard、线索、转报名与财务结果不泄露其他校区。

## 7. Wrong vs Correct

### Wrong

```ts
if (input.data.campusId) await assertActiveCampus(input.data.campusId);
await updateExistingLead(input.id, input.data);
```

这会让已归属停用校区的线索在未更换 `campusId` 时继续写入。

### Correct

```ts
await assertWritableCampus(tx, {
  organizationId: input.organizationId,
  campusAccess: input.campusAccess,
  campusId: current.campusId,
});
```

先在事务中重检既有归属校区；若要变更归属，再对目标校区执行同样检查。

## 场景：成员权限变更与领域写入并发

### 1. Scope / Trigger

- 触发：任何接收 `userId`、`organizationId` 与预解析 `CampusAccess` 的领域写操作。
- 目的：防止请求在 middleware 通过后，成员被移除、降级或缩小校区范围，仍使用旧授权快照提交。

### 2. Signatures

- 写 repository 接收 `userId`，在事务内调用 `getCurrentWriteCampusAccess(tx, { organizationId, userId, allowedRoles })`。
- 成员范围变更和领域写入都必须先获取 `pg_advisory_xact_lock(hashtext(organizationId))`。

### 3. Contracts

- API 层解析的 `CampusAccess` 仅用于当前请求读取与响应；它不能作为写事务的最终授权依据。
- 事务锁取得后，重新锁定 `organization_member`，按当前角色和 `organization_member_campus` 计算实际范围；owner/admin 固定为 `all`。

### 4. Validation & Error Matrix

| 条件 | 数据库领域错误 | API 语义 |
| --- | --- | --- |
| 成员已移除或不再具备领域角色 | `MEMBER_FORBIDDEN` | `FORBIDDEN` |
| 成员范围已移除目标校区 | `CAMPUS_OUT_OF_SCOPE` | `FORBIDDEN` |
| 目标校区已停用 | `CAMPUS_INACTIVE` | `CONFLICT` |

### 5. Good / Base / Bad Cases

- Good: 范围未变时，使用当前事务重新计算的范围写入启用校区。
- Base: 同一时刻的成员范围变更与写入按机构锁串行，后获得锁的一方基于最新提交状态执行。
- Bad: 直接把 router middleware 中的 `CampusAccess` 传给 `assertWritableCampus`，不重新读取成员关系。

### 6. Tests Required

- PostgreSQL 集成测试先取得允许写入的范围快照，再将成员范围切换到另一校区，断言 create/update 均返回 `CAMPUS_OUT_OF_SCOPE`，且既有数据未变。
- 覆盖成员移除或角色降级后返回 `MEMBER_FORBIDDEN`。

### 7. Wrong vs Correct

#### Wrong

```ts
await assertWritableCampus(tx, { campusAccess: input.campusAccess, campusId });
```

#### Correct

```ts
const campusAccess = await getCurrentWriteCampusAccess(tx, {
  organizationId: input.organizationId,
  userId: input.userId,
  allowedRoles,
});
await assertWritableCampus(tx, { campusAccess, campusId });
```

# 全局搜索只读契约

## 场景：跨领域、受限全局搜索

### 1. Scope / Trigger

- 触发：同一查询同时涉及 Web、oRPC 契约、API 授权编排与 DB 多领域投影。
- 目标：成员只能得到当前机构、当前角色和当前校区范围内的搜索结果；客户端不得提供或拼接授权边界。

### 2. Signatures

```ts
training.search.global.input(globalSearchInputSchema)
searchGlobal({ organizationId, userId, role, campusAccess }, { query })
searchGlobalRecords({ organizationId, userId, campusAccess, kinds, query })
```

### 3. Contracts

- `query`：服务端 trim 后长度为 2～100；`%`、`_`、`\\` 必须按字面量转义后才能参与 `ILIKE`。
- 响应：按判别 `kind` 分组；每组最多 5 条，内部多取 1 条计算 `hasMore`。
- 每项只可返回稳定 ID、白名单标题及脱敏摘要；手机号可匹配但不得原样返回，金额、备注和自由文本不得进入摘要。
- router 必须使用 `organizationProcedure`，并把 `organizationId`、`userId`、`role`、`campusAccess` 从服务端 context 显式传给 repository。

### 4. Validation & Error Matrix

| 条件 | 行为 |
| --- | --- |
| 少于 2 字符或超过 100 字符 | Zod 参数错误，Web 不发请求 |
| 角色没有某类资源权限 | 不调度该类查询，也不返回空分组 |
| 无校区访问范围 | SQL 使用 `false` 条件，不返回记录 |
| 任一领域查询失败 | 整个搜索请求失败，Web 显示错误而非空结果 |

### 5. Good / Base / Bad Cases

- Good：finance 只收到本校区账单与收据；consultant 只收到线索与学员。
- Base：owner 搜索课程编码时只返回标题与编码，不返回课程内部说明。
- Bad：从 client input 接收 `organizationId`、`campusIds` 或 `teacherId` 后再查询；这会绕过当前会话的授权边界。

### 6. Tests Required

- 覆盖 owner/admin、campus_manager、consultant、finance、teacher 的 kind 集合与机构/校区隔离。
- 覆盖联系人手机号匹配但响应脱敏、6 条命中时只返回 5 条并设 `hasMore`。
- 覆盖 `%`、`_` 与反斜杠查询不会扩大匹配范围。

### 7. Wrong vs Correct

#### Wrong

```ts
searchGlobalRecords({ organizationId: input.organizationId, campusIds: input.campusIds });
```

#### Correct

```ts
searchGlobalRecords({
  organizationId: context.organization.id,
  userId: context.session.user.id,
  campusAccess: context.campusAccess,
  kinds: getGlobalSearchKindsForRole(context.role),
  query: input.query,
});
```

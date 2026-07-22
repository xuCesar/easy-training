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
training.leads.get({ id })
training.teaching.{courses|classes|lessons}.list({ ..., targetId? })
training.teaching.teacherWorkspace.lessons({ from, to, targetId? })
```

### 3. Contracts

- `query`：服务端 trim 后长度为 2～100；`%`、`_`、`\\` 必须按字面量转义后才能参与 `ILIKE`。
- 响应：按判别 `kind` 分组；每组最多 5 条，内部多取 1 条计算 `hasMore`。
- 每项只可返回稳定 ID、白名单标题及脱敏摘要；手机号可匹配但不得原样返回，金额、备注和自由文本不得进入摘要。
- router 必须使用 `organizationProcedure`，并把 `organizationId`、`userId`、`role`、`campusAccess` 从服务端 context 显式传给 repository。
- 搜索结果只负责提供稳定目标 ID，不能作为目标页的授权缓存。深链接页面必须调用目标领域 API，重新执行机构、校区、角色或教师绑定校验。
- `targetId` 是追加加载通道：常规列表仍按当前筛选返回；目标不在分页、筛选或日期窗口内时，单独受权加载并去重追加，不能用目标替换常规列表。
- 不存在与不可见目标使用同一用户文案并用 replace navigation 清理对应参数；瞬时网络或服务端错误保留 URL，页面提供重试。

### 4. Validation & Error Matrix

| 条件 | 行为 |
| --- | --- |
| 少于 2 字符或超过 100 字符 | Zod 参数错误，Web 不发请求 |
| 角色没有某类资源权限 | 不调度该类查询，也不返回空分组 |
| 无校区访问范围 | SQL 使用 `false` 条件，不返回记录 |
| 任一领域查询失败 | 整个搜索请求失败，Web 显示错误而非空结果 |
| 目标不存在、跨机构、越权校区或不属于当前教师 | 目标领域返回 NOT_FOUND/FORBIDDEN；Web 不泄露原因并清理目标参数 |
| 目标超出当前筛选、分页或日期窗口 | 常规列表照常返回，受权目标去重追加 |
| 目标加载发生瞬时错误 | 保留目标参数和重试入口，不误判为空结果 |

### 5. Good / Base / Bad Cases

- Good：finance 只收到本校区账单与收据；consultant 只收到线索与学员。
- Base：owner 搜索课程编码时只返回标题与编码，不返回课程内部说明。
- Bad：从 client input 接收 `organizationId`、`campusIds` 或 `teacherId` 后再查询；这会绕过当前会话的授权边界。
- Good：教师课次目标同时匹配当前成员、teacher binding 与 `lesson.teacherId`，即使课次在默认日期范围外也可加载。
- Bad：直接使用搜索响应中的标题和摘要拼装详情；搜索结果可能过期且不是领域授权凭据。

### 6. Tests Required

- 覆盖 owner/admin、campus_manager、consultant、finance、teacher 的 kind 集合与机构/校区隔离。
- 覆盖联系人手机号匹配但响应脱敏、6 条命中时只返回 5 条并设 `hasMore`。
- 覆盖 `%`、`_` 与反斜杠查询不会扩大匹配范围。
- 覆盖目标在常规筛选/日期范围外仍被追加且不重复；跨机构、越权校区和其他教师目标均不可见。
- 浏览器覆盖刷新、后退、关闭、无效目标清理，以及瞬时错误保留 URL 并可重试。

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

#### Wrong：把目标搜索当成列表替代或授权缓存

```ts
const items = targetId ? [cachedSearchItem] : await listNormally(filters);
```

#### Correct：常规列表与目标分别受权加载后去重

```ts
const [items, targets] = await Promise.all([
  listNormally({ organizationId, campusAccess, ...filters }),
  targetId ? loadAuthorizedTarget({ organizationId, campusAccess, targetId }) : [],
]);
return appendTarget(items, targets[0]);
```

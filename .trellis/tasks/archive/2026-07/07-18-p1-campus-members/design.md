# P1 技术设计：多校区与成员角色管理

## 设计目标

在不改变既有机构隔离方式的前提下，新增一个可复用的服务端 `CampusAccess` 边界。当前线索、转报名、工作台和财务全部使用该边界；未来校区业务也通过同一边界接入，避免每个模块各自解释角色范围。

## 数据模型

### 校区

在 `campus` 新增 `is_active boolean not null default true`。停用是状态变更，绝不删除校区；现有记录、范围关联和历史报表继续可读。

### 成员范围

在 `organization_member` 新增 `campus_access_mode` 枚举：`all`、`selected`。

- `owner` 与 `admin` 固定为 `all`，且不写入范围子表。
- 非全局角色的 `selected` 模式通过 `organization_member_campus` 保存零到多个校区；零条关联就是无校区业务访问权。
- 关联表同时引用 member 与 campus；服务端在写入时验证二者属于同一机构。删除 member 或 campus 时清理关联。
- 停用校区不删除已有范围关联，以便该成员继续查看自己范围内的历史记录；新写入仍被校区状态拦截。

组织中间件将 membership 映射为以下判别联合并放入 oRPC context：

```ts
type CampusAccess =
  | { kind: "all" }
  | { kind: "selected"; campusIds: readonly string[] }
  | { kind: "none" };
```

`owner`、`admin` 总是 `all`。其他角色按 `campus_access_mode` 与实际范围行解析。Repository 接收该结构，而不是接收前端传入的范围。

### 邀请

新增 `organization_invitation` 与 `organization_invitation_campus`：

- 邀请主表存机构、`email_normalized`、`token_hash`、预设角色、预设访问模式、创建人、`expires_at`、`revoked_at`、`claimed_at`、领取人及时间戳。
- token 至少 256 bit 随机值，数据库只有 SHA-256 hash；`token_hash` 唯一。
- 对同机构、同规范化邮箱，创建或重发在同一事务内撤销其他未领取且未撤销的邀请，再写新记录与范围。邀请创建输入包含幂等请求 ID，避免双击生成又立即撤销的链接。
- 领取时锁定邀请行，检查 hash、未过期、未撤销、未领取、规范化邮箱相同、预设校区仍属于机构；在同一事务插入 membership、范围、更新当前 session 的 `activeOrganizationId`、标记领取并写审计。
- 不允许通过邀请创建 `owner`。管理员不能邀请或管理 owner；owner 可以创建和调整非 owner 成员。

链接形态为 `https://<web-origin>/invite#token=<raw-token>`。fragment 不发送到服务端；页面读取后以 POST body 调用领取接口，再立即用 `history.replaceState` 移除。页面设置 `Referrer-Policy: no-referrer`。

**安全边界**：本期没有可用的邮箱验证发送器。因此领取条件的“邮箱匹配”仅是账户属性匹配，不等价于邮箱所有权证明。管理端和受邀页必须如实说明，不能写作“完全防转发”。为未来验证能力预留条件：启用后同时要求 `session.user.emailVerified === true`。

### 审计

新增仅追加的 `organization_audit_event`：机构、动作、实体类型、实体 ID、操作者、目标成员、发生时间、`before` / `after` JSONB 脱敏快照。为机构时间线和实体回溯添加索引，并用数据库触发器阻止更新已有审计行。

动作包含校区创建/更新/启停、邀请创建/撤销/领取、成员角色变更、范围替换和成员移除。快照只保存角色、范围 ID、状态和邮箱掩码；禁止保存原始或 hash token、cookie、session、密码和完整邮箱。

## 授权与一致性

### 角色管理策略

| 操作人 | 权限 |
| --- | --- |
| `owner` | 管理所有校区、邀请、非 owner 成员、角色与范围；可授予 owner，但不得移除或降级最后一位 owner。 |
| `admin` | 管理校区及所有非 owner 成员；不能创建、移除或降级 owner，也不能把成员升级为 owner。 |
| `campus_manager` | 仅查看自己范围内的校区与成员摘要。 |
| 其他角色 | 不具备校区与成员管理权限。 |

成员变更、范围替换、移除与 owner 计数在一个事务中按机构 ID 获取 advisory lock，然后锁定相关 membership。事务内重新读取操作者和目标成员，保证角色刚变更或成员刚移除的请求不能凭旧 middleware context 完成管理操作。成员移除还会清理该用户所有指向此机构的 `activeOrganizationId`。

### 校区写入策略

管理校区的启停写入锁定 campus 行并写审计。任何归属校区的领域写入在自己的事务内锁定 campus 行，按顺序验证：机构归属、操作者 `CampusAccess`、`is_active`。读取历史数据不加 `is_active` 条件；仅新建/变更的选项和提交被拒绝。

对于受限成员，现有 `campusId IS NULL` 线索不属于任何可授权校区，读取、导出、跟进和转化均拒绝；全机构成员维持原行为。这一策略避免“无校区归属”成为跨校区旁路。

## API 与前端契约

新增的 oRPC 契约、router 与 repository 仍按 `contracts -> routers -> repositories -> db repositories` 分层：

- `training.campuses`: `list`、`create`、`update`、`setActive`。
- `training.members`: `list`、`summary`、`updateRoleAndAccess`、`remove`。
- `training.invitations`: `list`、`create`、`revoke`、`resend`、`claim`。

`claim` 是已登录保护过程，但不要求当前机构上下文，避免无 membership 的受邀用户先被自动创建为新机构 owner。公开邀请页面承载登录/注册与领取的连续流程，成功后才进入受保护区。

管理端增加 `/settings/campuses`、`/settings/members` 和公开 `/invite`。前两者复用现有 TanStack Query + oRPC 模式、`packages/ui` 的表单、表格、确认弹窗、Toast 与 Lucide 图标；侧栏只对有管理权限的角色展示入口。校区范围变更或停用后使线索、转报名、工作台、财务及当前机构查询失效。

## 迁移、兼容与回滚

1. 增量 migration 先添加 `campus.is_active default true`，现有数据自动保持启用。
2. 新表与索引为追加式，不修改既有业务外键或删除历史数据。
3. 部署顺序是 migration 先行，再发布兼容代码；未配置范围的既有非 owner membership 映射为 `all`，避免现网用户突然失去访问。管理员首次调整后可改为 `selected`。
4. 回滚应用时，新字段和新表不会影响旧代码；回滚 migration 只在确认不再需要 P1 数据后执行，生产环境不得删除已产生审计或邀请记录来“回滚”。

## 测试设计

- `organization-context.integration.ts`：移除即时失效、角色即时生效、最后 owner 与并发变更。
- 新成员/校区集成测试：跨机构、角色矩阵、范围替换、停用和审计。
- `leads.integration.ts`、`enrollment-conversion.integration.ts`：范围 SQL 过滤、停用后的写入拒绝、历史可读与停用-提交竞态。
- `finance.integration.ts`、`training-dashboard.integration.ts`：范围内统计、账单详情与收款不能越权。
- Web 测试与浏览器检查：邀请 token 清理、复制、确认操作、空/错/权限不足和移动端布局。

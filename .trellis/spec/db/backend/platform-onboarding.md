# 平台机构开通契约

## 1. Scope / Trigger

适用于平台操作员通过 Web/API 创建、查询、重新生成或撤销机构开通邀请，以及受邀用户注册后初始化首个机构 owner。该流程跨越平台授权、API、Web、数据库 migration 和审计，且不依赖任何机构成员上下文。

## 2. Signatures

- 平台能力入口：`platformProcedure`，要求有效登录会话及 `PlatformAuthorizationProvider.can(subject, "organization:onboard") === true`。
- 创建：`createOnboardingInvitationRecord({ email, organizationName, note?, actorUserId?, requestId?, source? })`。
- 重新生成：`rotateOnboardingInvitationRecord({ invitationId, actorUserId, requestId, source? })`。
- 撤销：`revokeOnboardingInvitationRecord({ invitationId, actorUserId, source? })`。
- 最终领取锁：`lockActiveOnboardingInvitation(tx, email, token)`；邮箱和同一个 token 必须同时匹配。
- break-glass：`create-onboarding-link.sh [--rotate] <email> <organization-name> [note]`。

## 3. Contracts

- `PLATFORM_OPERATOR_EMAILS` 是服务端逗号分隔邮箱白名单；归一化为小写并校验邮箱。未配置时 fail closed，且只有 `emailVerified = true` 的白名单用户具有平台能力。
- `/platform/onboarding` 与 `platform.*` API 不得依赖当前机构、机构角色或 `organizationProcedure`；机构 owner/admin 不自动获得平台权限。
- 同一归一化邮箱最多存在一条 `revokedAt IS NULL AND claimedAt IS NULL` 的开放邀请。普通创建遇到待领取记录返回冲突；只有显式 rotate 才使旧链接失效并创建新记录。
- 邀请固定有效 7 天。明文 token 只在成功创建/重新生成响应中返回一次；数据库只保存 SHA-256 hash，链接使用 `/onboard#token=...`，列表、日志和审计均不得包含 token 或 token hash。
- `requestId` 保护创建和重新生成的重复提交。请求重放返回冲突，不能再次显示原链接。
- 邀请状态为 `pending | claimed | expired | revoked`；列表使用 `(createdAt, id)` 游标倒序分页。
- 平台事件写入独立 `platformAuditEvent`，并与邀请或机构创建使用同一事务。平台审计可记录必要目标邮箱/机构摘要和 UUID，不记录备注正文或密钥。

## 4. Validation & Error Matrix

| 条件 | 领域/API 结果 |
| --- | --- |
| 未登录 | `UNAUTHORIZED` |
| 非白名单、未验证邮箱或空白名单 | `FORBIDDEN` |
| 同邮箱已有待领取邀请而执行 create | `INVITATION_PENDING` / `CONFLICT` |
| requestId 已使用 | `REQUEST_REPLAY` / `CONFLICT` |
| rotate/revoke 目标不存在 | `INVITATION_NOT_FOUND` / `NOT_FOUND` |
| rotate/revoke 已领取邀请 | `INVITATION_CLAIMED` / `CONFLICT` |
| revoke 已过期邀请 | `INVITATION_EXPIRED` / `CONFLICT` |
| revoke 已撤销邀请 | 返回既有撤销时间，不重复写审计 |
| 最终建机构时邮箱匹配但 token 不匹配/缺失 | 不允许自动创建机构 |
| 游标不可解析或字段无效 | `INVALID_CURSOR` / `BAD_REQUEST` |

## 5. Good / Base / Bad Cases

- Good：已验证的白名单操作员创建“待完善机构”邀请，立即复制一次性链接；受邀邮箱携带同一 token 注册并在同一事务创建机构、owner、领取状态和审计。
- Base：同邮箱已有 pending 邀请时 create 明确冲突；操作员确认 rotate 后旧 token 立即失效，新 token 只显示一次。
- Bad：把机构 `owner` 角色当作平台权限；仅在注册预检校验 token、最终建机构只按邮箱匹配；或把 token 放入 query、列表行、日志、审计 metadata。

## 6. Tests Required

- 授权矩阵覆盖：已验证白名单允许；普通 owner/admin、未验证白名单和空白名单拒绝。
- PostgreSQL 集成测试覆盖 create 冲突、显式 rotate、旧 token 失效、新 token 可用、revoke 幂等、过期/已领取冲突和 requestId 重放。
- 回归测试必须模拟预检成功后 token 被重新生成，断言旧 token 在最终事务锁阶段不能创建机构。
- 每个成功 create/rotate/revoke/claim 恰有一条 `platformAuditEvent`；失败或幂等撤销不新增事件；序列化结果和审计文本不包含 token、token hash 或备注正文。
- HTTP 测试断言 `/rpc/platform/onboarding/*` 响应包含 `Cache-Control: no-store`。

## 7. Wrong vs Correct

### Wrong

```ts
// 注册预检检查过 token，最终写入却只按邮箱锁定邀请。
const invitation = await lockActiveOnboardingInvitation(tx, user.email);
```

### Correct

```ts
// 最终建机构事务再次绑定同一邮箱和同一 token，关闭 TOCTOU 窗口。
const invitation = await lockActiveOnboardingInvitation(
  tx,
  user.email,
  input.onboardingToken,
);
```

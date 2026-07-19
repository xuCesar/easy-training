# P0 邀请邮箱控制权验证

## Goal

确保成员邀请只能由已验证并与受邀地址一致的邮箱领取，避免仅凭会话中可伪造/未控制的同名邮箱字符串加入机构。

## Confirmed Facts

- `user.emailVerified` 已存在、非空且默认 `false`；无需 schema migration。
- 当前领取事务仅规范化比较 session 邮箱和邀请邮箱，未验证 `emailVerified`。
- Better Auth 未配置验证邮件投递；重发邀请只轮换邀请 token。缺少邮件提供商、发件域名与凭据，不能交付端到端邮件验证。

## Requirements

- API 将会话的 `user.emailVerified` 显式传入 DB 邀请领取事务；未验证用户必须在创建成员、切换 session 和写审计之前被拒绝。
- 保持 token、邮箱规范化匹配、撤销、过期、事务锁和领取审计的既有语义；已验证但邮箱不匹配仍使用现有错误。
- API 将未验证拒绝映射为可理解的 `FORBIDDEN` 错误。
- 邀请页提示当前用户必须先验证受邀邮箱，并禁用领取操作；无邮件投递能力时不展示无效的“发送验证邮件”按钮。
- 不开启 Better Auth 全局 `requireEmailVerification`，也不假称本任务已提供邮件验证链路。

## Acceptance Criteria

- [ ] 未验证但同邮箱领取被拒绝，且成员、active organization 与领取审计均无变化。
- [ ] 已验证同邮箱维持成功路径；已验证不同邮箱维持原有不匹配错误。
- [ ] DB、API、Web 的错误与禁用态一致，服务端仍为最终安全边界。
- [ ] PostgreSQL 集成测试、类型检查、Biome 和生产构建通过。

## Out of Scope

- 邮件供应商、发送域名、凭据、验证链接发送/重发和 Better Auth 全局登录限制。

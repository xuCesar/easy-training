# P0 邀请邮箱控制权验证：技术设计

领取数据流为 `session.user.emailVerified → API claimInvitation → claimInvitationRecord`。DB 事务在现有 token/邀请锁定和邮箱匹配前拒绝 `emailVerified=false`，抛出 `INVITATION_EMAIL_UNVERIFIED`；这样不会产生成员、session 或审计的部分副作用。

API repository 只负责将会话验证状态传入并把该领域错误映射为 `FORBIDDEN`。Web 使用会话用户的 `emailVerified` 派生提示和 disabled 状态，但不承担安全判定。无需 auth schema/migration 或 Better Auth 配置变更。

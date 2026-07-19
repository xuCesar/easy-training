# Repository 调研：邀请邮箱控制权

调研日期：2026-07-19；仅记录已验证的代码库事实。

## 结论

- `user.emailVerified` 已存在，`notNull` 且默认 `false`，不需要 schema migration。
- 邀请领取目前只在 `claimInvitationRecord` 规范化比较 session 邮箱和受邀邮箱，未检查 `emailVerified`。
- Better Auth 当前仅启用邮箱密码登录；未配置验证邮件投递或 `requireEmailVerification`。重发邀请仅轮换 token 并返回由管理员复制的链接。

## P0 最小方案

- API 将 `context.session.user.emailVerified` 传给 DB 领取路径；未验证用户在领取前以明确领域错误拒绝，并映射为 `FORBIDDEN`。
- 邀请页显示“需先验证受邀邮箱”，并禁止领取。没有邮件提供商/发件域名/凭据前，不提供伪造的验证邮件按钮。
- 不在缺少投递能力时开启全局 `requireEmailVerification`，避免让全部未验证用户无法登录。

## 回归测试

- 未验证且同邮箱：拒绝、不创建成员、不切换 active organization、不写领取审计。
- 已验证且同邮箱：保持现有领取成功路径。
- 已验证但邮箱不匹配：保持既有不匹配错误。

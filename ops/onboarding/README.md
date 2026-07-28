# 机构开通邀请运维说明

日常操作使用 Web 页面 `/platform/onboarding`。SSH 脚本仅作为 Web/API 不可用时的 break-glass 路径，不是绕过平台权限审批的常规入口。

## 平台操作员配置

服务端环境变量：

```dotenv
PLATFORM_OPERATOR_EMAILS=operator-a@example.com,operator-b@example.com
```

- 只配置已完成邮箱验证的账号。
- 邮箱以逗号分隔；服务端会去除空格、转小写并校验格式。
- 留空或不配置时平台管理能力 fail closed，所有账号都不能访问平台 onboarding API。
- 该变量只能存在于服务端运行环境，不得添加为 `VITE_*` 或写入客户端配置。

配置变更后重启服务端，并分别验证白名单账号、普通机构 owner/admin 和未验证邮箱账号。

## 发布顺序

1. 备份数据库并确认当前 migration 版本。
2. 执行 `pnpm db:migrate`，保留新增表和 nullable 字段。
3. 部署支持新 schema 的 server 和更新后的 break-glass 脚本；先保持 `PLATFORM_OPERATOR_EMAILS` 为空。
4. 验证既有 `/onboard#token=...` 邀请仍可注册并创建机构 owner。
5. 配置首批操作员邮箱并重启服务。
6. 验证 Web 创建、重新生成、撤销、领取和平台审计。

## Break-glass 脚本

默认创建：

```bash
bash create-onboarding-link.sh owner@example.com "待完善机构" "变更单号"
```

若同邮箱已有待领取邀请，脚本会拒绝并回滚。只有确认旧链接需要立即失效时才执行：

```bash
bash create-onboarding-link.sh --rotate owner@example.com "待完善机构" "变更单号"
```

脚本要求：

- 仅受控运维账号可 SSH 和读取 `/home/ops/.easy-training-db.env`。
- 数据库必须已经应用平台审计 migration。
- 标准输出中的完整链接只能通过批准的安全渠道发送；不得粘贴到工单公开评论或长期日志。
- `/home/ops/onboarding.log` 和 `platform_audit_event` 不记录 token、token hash 或备注正文。

## 回滚

- 清空 `PLATFORM_OPERATOR_EMAILS` 并重启 server，可立即关闭 Web 平台操作。
- 应用回滚时保留新增 enum、表、索引和 nullable 字段，不执行破坏性 down migration。
- 已签发且未撤销的邀请继续使用原 `/onboard` 流程。
- 若怀疑 token 绑定存在缺陷，先关闭入口并撤销受影响的待领取邀请，再评估应用回滚。

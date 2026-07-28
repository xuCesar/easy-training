# 生产部署运维手册(2026-07-26 首次部署)

单实例受控试运行部署在腾讯云轻量服务器(`ops@150.158.75.37`,宝塔面板,与其他项目混布)。
公开地址:<https://et.eztime-lab.com>(同源部署:nginx 将 `/rpc`、`/api`、`/readyz` 反代到
`127.0.0.1:3010`,其余路径走静态 SPA)。

## 服务器布局

| 项 | 位置 |
| --- | --- |
| 应用版本目录 | `/home/deploy/apps/easy_training/releases/<时间戳>`,`current` 软链指向当前版本 |
| 运行时 env | `/home/deploy/apps/easy_training/shared.env`(600,软链为各版本的 `.env`) |
| 前端静态 | `/www/wwwroot/et.eztime-lab.com` |
| nginx 站点 | `/www/server/panel/vhost/nginx/et.eztime-lab.com.conf`(即本目录 `nginx-et.eztime-lab.com.conf`) |
| TLS 证书 | certbot,`/etc/letsencrypt/live/et.eztime-lab.com/`,随系统 `certbot-renew.timer` 自动续期 |
| 进程守护 | PM2(`deploy` 用户),进程名 `easy-training`,已 `pm2 save` |
| 数据库 | 本机 PostgreSQL 18(`/www/server/pgsql`,仅 localhost:5432),库 `easy_training` |
| DB 凭据 | `/home/ops/.easy-training-db.env`(600):`MIGRATOR_DATABASE_URL` / `APP_DATABASE_URL` |

数据库角色分离(`setup-db.sh` 创建):`et_migrator` 为库 owner、只用于迁移;`et_app`
仅有 DML(默认权限授予),为应用运行账号。

## 发布流程

服务器内存有限(4G,与其他项目共享),**禁止在服务器上执行 pnpm install / build**。

### 方式 A:CI 产物(推荐,与开发机解耦)

develop 每次 push 会触发 `Release Artifacts` 工作流(也可手动 dispatch),
产出 `server-bundle-<sha>` 与 `web-dist-<sha>` 两个 artifact(保留 14 天):

```bash
# 1. 下载并解包指定提交的产物
gh run download --name server-bundle-<sha> --name web-dist-<sha> -D /tmp/et-release
mkdir -p /tmp/et-release/server /tmp/et-release/web
tar -C /tmp/et-release/server -xzf /tmp/et-release/server-bundle-<sha>/server-bundle.tar.gz
tar -C /tmp/et-release/web -xzf /tmp/et-release/web-dist-<sha>/web-dist.tar.gz

# 2. 上传
rsync -az --delete /tmp/et-release/server/ ops@150.158.75.37:/home/ops/et-upload/server/
rsync -az --delete /tmp/et-release/web/ ops@150.158.75.37:/home/ops/et-upload/web/

# 3. 迁移(如有)与发布,同方式 B 的第 4、5 步
```

### 方式 B:本地构建

```bash
# 1. 本地构建
pnpm --filter server build
cd apps/web && VITE_SERVER_URL=https://et.eztime-lab.com VITE_ALLOW_PUBLIC_SIGNUP=false npx vite build && cd -

# 2. 生成裁剪后的生产目录(dist 需手动补入)
pnpm --filter=server deploy --prod --legacy /tmp/et-server-deploy
cp -R apps/server/dist /tmp/et-server-deploy/dist

# 3. 上传
rsync -az --delete /tmp/et-server-deploy/ ops@150.158.75.37:/home/ops/et-upload/server/
rsync -az --delete apps/web/dist/ ops@150.158.75.37:/home/ops/et-upload/web/

# 4. 数据库迁移(如有新迁移;经 SSH 隧道用迁移账号执行)
ssh -f -N -L 15432:127.0.0.1:5432 ops@150.158.75.37
# 取 /home/ops/.easy-training-db.env 中 MIGRATOR_DATABASE_URL,把 5432 改为 15432:
cd packages/db && DATABASE_URL="postgresql://et_migrator:<密码>@127.0.0.1:15432/easy_training" npx drizzle-kit migrate

# 5. 发布(版本目录 + current 软链 + PM2 重启 + readyz 校验)
scp ops/deploy/release.sh ops@150.158.75.37:/home/ops/release.sh
ssh ops@150.158.75.37 'bash /home/ops/release.sh'
```

## 回滚

```bash
ssh ops@150.158.75.37
ls /home/deploy/apps/easy_training/releases          # 找到上一版本
sudo -u deploy ln -sfn /home/deploy/apps/easy_training/releases/<上一版本> /home/deploy/apps/easy_training/current
# 注意:必须 delete 后以物理路径重新 start——PM2 会钉死首次启动时解析的路径,
# 仅 restart 不会跟随软链(2026-07-26 事故教训,详见 release.sh 注释)
sudo -u deploy bash -lc 'pm2 delete easy-training'
sudo -u deploy bash -lc 'cd /home/deploy/apps/easy_training/releases/<上一版本> && pm2 start dist/index.mjs --name easy-training && pm2 save'
curl -sf http://127.0.0.1:3010/readyz
sudo -u deploy bash -lc 'pm2 describe easy-training' | grep 'script path'   # 必须指向目标版本
```

前端如需回滚,重新 rsync 旧产物到 `/www/wwwroot/et.eztime-lab.com`。
涉及数据库迁移的回滚需按迁移内容单独评估,不要盲目 down。

## 回滚演练记录(2026-07-26)

真实演练一次(`rollback-drill` 流程):第二个版本 `20260726191454` 发布后,
回滚到 `20260726173608` 并验证 PM2 实际运行旧版本产物,再回切最新版。

- 回滚耗时 **1.69s**(软链切换 + PM2 restart + `/readyz` 通过);回切同为 1.69s
- 演练窗口内 0.2s 间隔探针:109 成功 / 6 失败(约 1.2s 不可用,单实例 restart 预期)
- 外网复核:`/readyz` OK、SPA 200

## 当前配置要点

- `EMAIL_ENABLED=true`:腾讯 SES 模板已通过审核，生产凭据已配置；密码重置、邀请和
  邮箱验证真实流程已于 2026-07-27 验证通过。后续发布必须保留 `shared.env` 中的
  邮件配置。
- `ALLOW_PUBLIC_SIGNUP` 未设置(默认关闭):受邀注册制(#58)
- `API_REFERENCE_ENABLED` 未设置:生产默认关闭(#62)
- 新机构开通(#66,2026-07-26 起):在服务器执行
  `bash /home/ops/create-onboarding-link.sh <邮箱> <机构名称> [备注]`
  生成 7 天有效的开通链接发给客户;客户用受邀邮箱注册后自动创建指定名称的机构
  并成为 owner,全程无需改 env、无注册窗口。同邮箱重发会撤销旧链接。
  (历史方式"临时开放注册"仅作应急备份,见 git 历史)

## 公网可用性拨测(2026-07-27)

腾讯云云拨测当前配置了以下三个基础可用性任务。`et-readyz-prod` 与
`et-tls-prod` 每 5 分钟使用深圳、上海、成都、广州、哈尔滨、郑州共 6 个国内
IDC 可用性节点；`et-cert-expiry-prod` 每 1 小时使用 2 个国内 IDC 可用性节点：

| 任务 | 任务 ID | 校验 |
| --- | --- | --- |
| `et-readyz-prod` | `task-5qnhgxsi` | HTTP 200（`[200,201)`）且正文包含 `OK` |
| `et-tls-prod` | `task-elb35qje` | `et.eztime-lab.com:443` 完成 TLS 握手 |
| `et-cert-expiry-prod` | `task-05dvr64y` | `/cert-expiryz` 返回 HTTP 200 且正文包含 `OK` |

- `/readyz` 与 TLS 拨测首轮 6 个节点均正常，TLS 详情数据包含有效握手时间。
- 证书有效期为 2026-07-26 至 2026-10-24；`certbot-renew.timer` 已启用且运行中，
  最近一次续期任务执行成功。
- 当前云拨测为 15 天免费试用，试用结束前必须决定购买套餐或迁移到其他外部监控，
  避免任务到期后静默失效。
- `easy-training-readyz-prod` 与 `easy-training-tls-prod` 告警策略已关联通知模板：
  正确率或成功率低于 100%、连续 2 个数据点异常时触发，每 1 小时重复通知。
- `easy-training-cert-expiry-prod` 告警策略已关联同一通知模板：正确率低于 100%、
  连续 2 个数据点异常时触发，每 1 小时重复通知。

真实投递演练（2026-07-28）：

- TLS：08:55 成功率降为 0% 并收到告警，09:10 恢复为 100% 并收到恢复通知，
  持续 15 分钟。
- `/readyz`：使用云拨测侧临时 body 校验错配触发，不修改生产响应；10:20 成功率
  降为 0% 并收到告警，10:30 恢复为 100% 并收到恢复通知，持续 10 分钟。
- 初次 readyz 演练通过 Nginx reload 制造 503，影响了 TLS 拨测；该方式已弃用，
  生产 Nginx 随后恢复且与仓库配置无差异。
- 正式配置已恢复：readyz 与 TLS 每 5 分钟拨测，连续 2 个数据点异常时触发。

### 证书提前到期预警

`easy-training-cert-expiry.timer` 每 12 小时检查一次生产证书。证书剩余有效期超过
30 天时，`https://et.eztime-lab.com/cert-expiryz` 返回 `OK`；不足 30 天或证书
无法读取时返回非 `OK`，供外部拨测按响应内容触发告警。检查脚本不读取或输出私钥。

腾讯云拨测使用以下配置：

- 任务名：`et-cert-expiry-prod`
- 类型：端口性能 / HTTP(s)
- 地址：`https://et.eztime-lab.com/cert-expiryz`
- 频率：1 小时；选择 2 个国内 IDC 可用性节点
- 响应校验：HTTP 200，响应内容部分匹配 `OK`
- 告警策略：`easy-training-cert-expiry-prod`，正确率低于 100%、连续 2 个数据点异常
  时触发，每 1 小时重复通知，复用生产拨测通知模板

首次安装或更新：

```bash
scp ops/monitoring/check-cert-expiry.sh \
  ops/monitoring/easy-training-cert-expiry.service \
  ops/monitoring/easy-training-cert-expiry.timer \
  ops@150.158.75.37:/home/ops/et-monitoring/
ssh ops@150.158.75.37
sudo install -d -m 0755 /var/lib/easy-training-monitoring
sudo install -m 0755 /home/ops/et-monitoring/check-cert-expiry.sh \
  /usr/local/sbin/easy-training-cert-expiry-check
sudo install -m 0644 /home/ops/et-monitoring/easy-training-cert-expiry.service \
  /etc/systemd/system/easy-training-cert-expiry.service
sudo install -m 0644 /home/ops/et-monitoring/easy-training-cert-expiry.timer \
  /etc/systemd/system/easy-training-cert-expiry.timer
sudo systemctl daemon-reload
sudo systemctl enable --now easy-training-cert-expiry.timer
sudo systemctl start easy-training-cert-expiry.service
```

验证：

```bash
systemctl status easy-training-cert-expiry.timer --no-pager
cat /var/lib/easy-training-monitoring/cert-expiryz
curl -sf https://et.eztime-lab.com/cert-expiryz
```

## 应用日志与异常告警

PM2 的 stdout/stderr 日志保留在 `/home/deploy/.pm2/logs/`。系统 `logrotate` 每日检查，
单个日志达到 10MB 时也可提前轮转，压缩保留 14 份。

`easy-training-app-log.timer` 每分钟增量扫描新日志，不回放安装前的历史内容。以下事件
会把 `https://et.eztime-lab.com/log-healthz` 置为 `ALERT` 并保持 20 分钟：

- HTTP 5xx 或 `http.unexpected_error`
- `email.failed` 或生产环境出现 `email.skipped`
- 线索导入完成后的站内通知投递失败（`lead_import_notification.failed`）
- 操作任务提醒 worker 执行失败或消息进入 dead 状态
- 服务关闭超时/失败
- stderr 中的显式错误、未捕获异常，以及 Better Auth 无法解析客户端 IP 的安全警告

普通的错误密码、用户不存在等认证警告不会触发。无新增异常且保持期结束后，状态自动
恢复为 `OK`。

腾讯云拨测使用以下配置：

- 任务名：`et-app-log-prod`
- 类型：端口性能 / HTTP(s)
- 地址：`https://et.eztime-lab.com/log-healthz`
- 频率：5 分钟；选择 2 个国内 IDC 可用性节点
- 响应校验：HTTP 200，响应内容包含 `OK`
- 告警策略：`easy-training-app-log-prod`，正确率低于 100%、连续 2 个数据点异常时
  触发，每 1 小时重复通知，复用生产拨测通知模板

真实投递演练（2026-07-28）：

- 通过向 PM2 stdout 写入仅含固定描述和演练 `requestId` 的
  `http.unexpected_error` 脱敏事件触发，不修改数据库或业务数据。
- 首次演练 11:05 触发，11:15 云监控记录恢复，但恢复通知未投递；确认通知模板已
  开启告警触发、告警恢复以及短信、邮件双通道后执行重试。
- 重试演练 11:40 正确率降为 0% 并收到告警，12:00 恢复为 100%，短信和邮件均
  收到恢复通知，持续 20 分钟。
- 服务器端已恢复 `/log-healthz=OK`，timer 为 `active`；告警策略已恢复每 5 分钟
  拨测、连续 2 个数据点异常触发、每 1 小时重复通知。
- 首次恢复通知漏投视为腾讯云通知链路的单次异常，试运行期继续观察恢复通知投递；
  若再次出现，需结合云监控告警历史向腾讯云提交工单。

安装或更新：

```bash
scp ops/monitoring/check-app-logs.sh \
  ops/monitoring/easy-training-app-log.service \
  ops/monitoring/easy-training-app-log.timer \
  ops/monitoring/easy-training-logrotate \
  ops@150.158.75.37:/home/ops/et-monitoring/
ssh ops@150.158.75.37
sudo install -m 0755 /home/ops/et-monitoring/check-app-logs.sh \
  /usr/local/sbin/easy-training-app-log-check
sudo install -m 0644 /home/ops/et-monitoring/easy-training-app-log.service \
  /etc/systemd/system/easy-training-app-log.service
sudo install -m 0644 /home/ops/et-monitoring/easy-training-app-log.timer \
  /etc/systemd/system/easy-training-app-log.timer
sudo install -m 0644 /home/ops/et-monitoring/easy-training-logrotate \
  /etc/logrotate.d/easy-training
sudo systemctl daemon-reload
sudo systemctl enable --now easy-training-app-log.timer
sudo systemctl start easy-training-app-log.service
```

验证：

```bash
systemctl status easy-training-app-log.timer --no-pager
cat /var/lib/easy-training-monitoring/log-healthz
curl -sf https://et.eztime-lab.com/log-healthz
sudo logrotate --debug /etc/logrotate.d/easy-training
```

## 备份失败与过期告警

`et-backup.sh` 仅在备份完整性自检和 COS 上传都成功后记录成功状态。COS 不可用时仍
保留本地加密备份，但任务返回失败。`easy-training-backup-health.timer` 每小时校验
最近一次结果、27 小时时效、COSFS 挂载和对应远端对象，结果通过
`https://et.eztime-lab.com/backup-healthz` 暴露为 `OK` 或 `ALERT`。

安装或更新：

```bash
scp ops/backup/et-backup.sh \
  ops/monitoring/check-backup-health.sh \
  ops/monitoring/easy-training-backup-health.service \
  ops/monitoring/easy-training-backup-health.timer \
  ops@150.158.75.37:/home/ops/et-monitoring/
ssh ops@150.158.75.37
sudo install -m 0755 /home/ops/et-monitoring/et-backup.sh \
  /usr/local/sbin/et-backup.sh
sudo install -m 0755 /home/ops/et-monitoring/check-backup-health.sh \
  /usr/local/sbin/easy-training-backup-health-check
sudo install -m 0644 /home/ops/et-monitoring/easy-training-backup-health.service \
  /etc/systemd/system/easy-training-backup-health.service
sudo install -m 0644 /home/ops/et-monitoring/easy-training-backup-health.timer \
  /etc/systemd/system/easy-training-backup-health.timer
sudo systemctl daemon-reload
sudo systemctl enable --now easy-training-backup-health.timer
sudo /usr/local/sbin/et-backup.sh
sudo systemctl start easy-training-backup-health.service
```

腾讯云拨测已配置：

- 任务名：`et-backup-health-prod`
- 类型：端口性能 / HTTP(s)
- 地址：`https://et.eztime-lab.com/backup-healthz`
- 频率：1 小时；选择 2 个国内 IDC 可用性节点
- 响应校验：HTTP 200，响应内容部分匹配 `OK`
- 告警策略：`easy-training-backup-health-prod`，正确率低于 100%、连续 2 个数据点
  异常时触发，每 1 小时重复通知，复用生产拨测通知模板

真实投递演练（2026-07-27）：

- 演练时临时调整为每 5 分钟拨测、连续 1 个数据点触发，结束后已恢复正式配置。
- 23:45 正确率降为 0%，短信和邮件均收到告警。
- 23:55 正确率恢复为 100%，短信和邮件均收到恢复通知，持续时间 10 分钟。
- 服务器恢复后 `/backup-healthz` 返回 `OK`，健康检查 timer 为 `active`。

验证：

```bash
systemctl status easy-training-backup-health.timer --no-pager
cat /var/lib/easy-training-monitoring/backup-last-result
cat /var/lib/easy-training-monitoring/backup-healthz
curl -sf https://et.eztime-lab.com/backup-healthz
```

## 受控生产冒烟记录（2026-07-28）

本次由试运行期生产运维责任人授权并使用机构负责人账号验收，全程只读，不创建、
修改、删除、导入、导出或发送业务数据。

- 发布版本：`current` 指向 `20260727225317`，PM2 `script path` 指向同一物理版本，
  状态为 `online`，重启次数为 0。
- 数据库：仓库与生产 `drizzle.__drizzle_migrations` 均为 42 条，仓库最新 migration
  为 `0041_organization_onboarding.sql`；运行账号 `et_app` 可正常读取 68 张业务表。
- 基础设施：Nginx 配置检查通过；首页、登录页、`/readyz`、`/log-healthz`、
  `/cert-expiryz`、`/backup-healthz` 均返回 HTTP 200，健康端点内容符合预期。
- 认证与权限：负责人真实登录成功；未登录访问 `/dashboard` 会跳转到 `/login`，
  登录后机构和负责人角色上下文正确。
- 核心页面：运营工作台、招生线索、学员中心、教务排课、应收账单、任务与提醒、
  经营分析、机构设置和操作审计均加载成功；当前无业务记录，页面显示一致的零值或
  空态，没有持续骨架屏、空白页或权限错误。
- 可观测性：应用页面控制台无自身错误；近期服务端关键日志仅命中本次已记录的受控
  告警演练事件。应用日志、证书到期和备份健康 timer 均为 `active`。
- 最近恢复证据：应用异常告警 11:40 触发、12:00 恢复，短信和邮件均收到告警与
  恢复通知；`/log-healthz` 已回到 `OK`。

结论：单实例、受邀制、少量真实机构边界下的首次生产只读冒烟通过。生产写入流程
未在本次人为造数；首次真实机构录入线索、学员、排课或财务数据时，仍需按业务权限
和审计记录观察，不将本次结果解释为容量、性能或 SLA 验收。

## 责任人与证据索引

试运行期生产运维责任人为机构负责人徐老师，联系方式沿用
`docs/compliance/README.md` 中的个人信息保护责任人记录。职责包括发布审批、告警
接收、备份恢复决策和演练结果确认；密钥与备份对象标识不进入仓库或 GitHub 评论。

| 证据 | 存放位置 |
| --- | --- |
| 当前应用版本与 PM2 运行路径 | 生产 `current` 软链、PM2 `script path`；发布结果回链 Issue #23 |
| 发布、回滚、TLS 与健康探针 | 本文及生产命令执行记录 |
| 云拨测任务与告警策略 | 腾讯云云拨测控制台；任务 ID 和稳定配置摘要记录在本文 |
| 备份、RPO/RTO 与隔离恢复 | `ops/backup/README.md`；敏感对象标识只保留在受控运维记录 |
| 首次生产冒烟 | 本文“受控生产冒烟记录”；详细状态回链 Issue #23 |
| 生产门禁总状态 | GitHub Issue #23；Issue #65 保持面向试运行范围的摘要 |

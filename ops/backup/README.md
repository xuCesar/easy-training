# 数据库备份与恢复(#23,2026-07-26 落地)

## 机制

- **备份**:`et-backup.sh`(部署于服务器 `/usr/local/sbin/et-backup.sh`,root cron
  `/etc/cron.d/et-backup` 每日 03:30 执行):`pg_dump -Fc` → AES-256-CBC(PBKDF2
  20 万次迭代)加密 → 本地 `/home/ops/et-backups/` 保留 7 天 → COSFS 挂载
  `/mnt/cos-backup/easy-training/` 保留 30 天。每次备份内置完整性自检
  (解密 + `pg_restore -l`)。
- **异地存储**:腾讯云 COS 桶 `easy-training-backup-1256191038`(ap-shanghai),
  cosfs 挂载(`setup-cos-mount.sh` 配置,fstab `nofail` 开机自动挂载);子账号
  桶级最小授权(读写),服务级接口无权限。
- **加密口令**:`/root/.et-backup-pass`(600,仅 root)。**必须另行离线保存一份**,
  口令丢失则全部备份不可恢复。口令不进入仓库、不离开服务器。
- **凭据布局**:COS 密钥在 `/home/ops/.easy-training-cos.env`(600)与
  `/etc/passwd-cosfs`(600,cosfs 使用);应用进程不持有任何备份/COS 凭据。

## RPO / RTO

- **RPO ≤ 24h**(每日一备)。试运行期数据录入频度低,可接受;录入量上升后
  评估加密 WAL 归档缩短 RPO。
- **RTO(实测)**:2026-07-26 恢复演练全程 **3 秒**(备份 324KB:解密 ≤1s、
  临时实例启动 1s、pg_restore 1s)。数据量增长后需按年度演练重新实测。

## 恢复演练记录(2026-07-26)

`restore-drill.sh`:在服务器上解密最新备份 → 一次性 Postgres 18 实例
(独立 datadir、仅 unix socket、trust 认证、不触碰生产实例与应用凭据)→
`pg_restore` → 抽样核验 → 实例销毁。

核验结果:public 表 67 张;组织=小天才艺术中心;校区=总校区/宁波;
user 1 行;organization_member 1 行(owner)。与生产一致。

## 恢复到生产的流程(灾难场景)

1. 从 COS(或本地 `/home/ops/et-backups/`)取最新 `easy_training-*.dump.enc`
2. `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:/root/.et-backup-pass -in <dump.enc> -out restore.dump`
3. 停应用:`sudo -u deploy bash -lc 'pm2 stop easy-training'`
4. 重建库(用 postgres 超级用户):`DROP DATABASE easy_training; CREATE DATABASE easy_training OWNER et_migrator;`
5. `pg_restore -d easy_training --no-owner --no-privileges restore.dump`(以 et_migrator 连接,
   使 et_app 的默认权限授予生效)
6. 起应用并验证:`pm2 start easy-training` → `/readyz` → 登录抽查

## 值守与告警

备份脚本仅在加密备份通过完整性检查并成功写入 COS 后记录 `OK`；COS 未挂载时会保留
本地备份，但记录 `ALERT` 并以非 0 退出。`easy-training-backup-health.timer`
每小时检查：

- 最近一次备份执行结果为 `OK`。
- 结果时间不超过 27 小时，避免 cron 停止后旧成功状态长期有效。
- COSFS 仍处于挂载状态。
- 最近一次成功结果对应的 COS 对象仍存在且不少于 1KB。

检查结果由 `https://et.eztime-lab.com/backup-healthz` 公开为 `OK` 或 `ALERT`，
不暴露备份路径、对象名、数据库连接或加密凭据。腾讯云拨测接入方式见
`ops/deploy/README.md`。

2026-07-27 已完成真实告警演练：端点临时切换为 `ALERT` 后，腾讯云正确率降为
0%，短信和邮件均于 23:45 送达；恢复真实健康状态后正确率回到 100%，短信和邮件
均于 23:55 收到恢复通知，告警持续 10 分钟。演练未修改数据库、备份文件或 COS
对象。

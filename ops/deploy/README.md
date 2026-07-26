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
| TLS 证书 | certbot,`/etc/letsencrypt/live/et.eztime-lab.com/`,随系统 certbot timer 自动续期 |
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
sudo -u deploy bash -lc 'pm2 restart easy-training'
curl -sf http://127.0.0.1:3010/readyz
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

- `EMAIL_ENABLED=false`:腾讯 SES 模板未过审(#59),过审后在 `shared.env` 补充 SES
  凭据并置 `EMAIL_ENABLED=true`,再 `pm2 restart easy-training --update-env`
- `ALLOW_PUBLIC_SIGNUP` 未设置(默认关闭):受邀注册制(#58)
- `API_REFERENCE_ENABLED` 未设置:生产默认关闭(#62)
- 首个机构账号引导(2026-07-26 已完成):注册流程会自动为新用户创建
  "<姓名>的机构" 并授予 owner(见 `packages/db/src/repositories/organization.ts`),
  无需种子脚本。操作步骤:后端临时置 `ALLOW_PUBLIC_SIGNUP=true` 并重启,
  前端用 `VITE_ALLOW_PUBLIC_SIGNUP=true` 重建换上 → 注册 → 立即关回两端并重建前端,
  校验 sign-up 探针返回 403、`user` 表无多余账号。机构/校区名称可在界面或 SQL 中更正

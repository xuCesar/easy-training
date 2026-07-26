#!/usr/bin/env bash
# easy-training 发布:/home/ops/et-upload -> 版本目录 + current 软链 + PM2
set -euo pipefail

APP_ROOT="/home/deploy/apps/easy_training"
RELEASE="$APP_ROOT/releases/$(date +%Y%m%d%H%M%S)"
ENV_FILE="$APP_ROOT/shared.env"
WEB_ROOT="/www/wwwroot/et.eztime-lab.com"
PUBLIC_ORIGIN="https://et.eztime-lab.com"

# 首次发布时生成 shared.env;之后复用(密钥不轮换)
if ! sudo -n test -f "$ENV_FILE"; then
	# shellcheck disable=SC1091
	APP_DATABASE_URL=$(grep '^APP_DATABASE_URL=' /home/ops/.easy-training-db.env | cut -d= -f2-)
	AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
	sudo -n install -m 600 -o deploy -g deploy /dev/null "$ENV_FILE"
	sudo -n tee "$ENV_FILE" > /dev/null <<EOF
DATABASE_URL=$APP_DATABASE_URL
BETTER_AUTH_SECRET=$AUTH_SECRET
BETTER_AUTH_URL=$PUBLIC_ORIGIN
CORS_ORIGIN=$PUBLIC_ORIGIN
PORT=3010
NODE_ENV=production
EMAIL_ENABLED=false
APP_PUBLIC_NAME=Easy Training
EOF
	echo "shared.env created"
fi

sudo -n mkdir -p "$RELEASE"
sudo -n cp -R /home/ops/et-upload/server/. "$RELEASE/"
sudo -n ln -s "$ENV_FILE" "$RELEASE/.env"
sudo -n chown -R deploy:deploy "$RELEASE"
sudo -n -u deploy ln -sfn "$RELEASE" "$APP_ROOT/current"

sudo -n rsync -a --delete /home/ops/et-upload/web/ "$WEB_ROOT/"
sudo -n chown -R www:www "$WEB_ROOT"

# PM2 会把首次 start 时解析到的物理路径钉死,restart 不跟随 current 软链
# (2026-07-26 事故:多次"发布"后实际仍在跑首个版本)。
# 因此每次发布都 delete 后以新版本的物理路径重新 start。
sudo -n -u deploy bash -lc 'pm2 delete easy-training' > /dev/null 2>&1 || true
sudo -n -u deploy bash -lc "cd '$RELEASE' && pm2 start dist/index.mjs --name easy-training && pm2 save" > /dev/null

sleep 3
RUNNING=$(sudo -n -u deploy bash -lc 'pm2 describe easy-training' | grep 'script path' | grep -o '/home/[^ ]*index.mjs')
if [ "$RUNNING" != "$RELEASE/dist/index.mjs" ]; then
	echo "PM2 script path mismatch: running $RUNNING, expected $RELEASE/dist/index.mjs" >&2
	exit 1
fi
curl -sf -m 5 http://127.0.0.1:3010/readyz && echo " readyz-ok release=$RELEASE running=$RUNNING"

#!/usr/bin/env bash
# easy-training 生产库初始化:迁移账号(owner)与运行账号(DML)分离。
# 密码只写入 /home/ops/.easy-training-db.env(600),不打印。
set -euo pipefail

PSQL="/www/server/pgsql/bin/psql"
SECRETS_FILE="/home/ops/.easy-training-db.env"

if sudo -n -u postgres "$PSQL" -tAc "SELECT 1 FROM pg_database WHERE datname='easy_training'" | grep -q 1; then
	echo "database easy_training already exists; aborting to avoid overwrite"
	exit 1
fi

MIG_PW=$(openssl rand -hex 24)
APP_PW=$(openssl rand -hex 24)

sudo -n -u postgres "$PSQL" -v ON_ERROR_STOP=1 \
	-v mig_pw="$MIG_PW" -v app_pw="$APP_PW" <<'SQL'
CREATE ROLE et_migrator LOGIN PASSWORD :'mig_pw';
CREATE ROLE et_app LOGIN PASSWORD :'app_pw';
CREATE DATABASE easy_training OWNER et_migrator;
SQL

sudo -n -u postgres "$PSQL" -v ON_ERROR_STOP=1 -d easy_training <<'SQL'
GRANT USAGE ON SCHEMA public TO et_app;
ALTER DEFAULT PRIVILEGES FOR ROLE et_migrator IN SCHEMA public
	GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO et_app;
ALTER DEFAULT PRIVILEGES FOR ROLE et_migrator IN SCHEMA public
	GRANT USAGE, SELECT ON SEQUENCES TO et_app;
SQL

umask 077
cat > "$SECRETS_FILE" <<EOF
MIGRATOR_DATABASE_URL=postgresql://et_migrator:${MIG_PW}@127.0.0.1:5432/easy_training
APP_DATABASE_URL=postgresql://et_app:${APP_PW}@127.0.0.1:5432/easy_training
EOF
echo "done: roles et_migrator/et_app, database easy_training, secrets in $SECRETS_FILE"

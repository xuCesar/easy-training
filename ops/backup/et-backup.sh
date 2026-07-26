#!/usr/bin/env bash
# easy-training 数据库加密备份(#23)
# - pg_dump 自定义格式 -> openssl AES-256 加密 -> 本地保留 7 天
# - 若 /mnt/cos-backup 已挂载(COSFS),同步到 COS 并保留 30 天
# 由 root cron 运行;口令文件 /root/.et-backup-pass(600,仅 root)
set -euo pipefail

PGDUMP="/www/server/pgsql/bin/pg_dump"
PSQL="/www/server/pgsql/bin/psql"
PASS_FILE="/root/.et-backup-pass"
LOCAL_DIR="/home/ops/et-backups"
REMOTE_DIR="/mnt/cos-backup/easy-training"
LOCAL_RETENTION_DAYS=7
REMOTE_RETENTION_DAYS=30

DB_URL=$(grep '^MIGRATOR_DATABASE_URL=' /home/ops/.easy-training-db.env | cut -d= -f2-)
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$LOCAL_DIR/easy_training-$STAMP.dump.enc"

if [ ! -f "$PASS_FILE" ]; then
	umask 077
	openssl rand -hex 32 > "$PASS_FILE"
	echo "generated new backup passphrase at $PASS_FILE — 立刻另行离线保存一份,丢失则备份不可恢复"
fi

mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR"

"$PGDUMP" "$DB_URL" -Fc \
	| openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$PASS_FILE" \
	> "$OUT.tmp"
mv "$OUT.tmp" "$OUT"

SIZE=$(stat -c %s "$OUT")
if [ "$SIZE" -lt 1024 ]; then
	echo "backup suspiciously small ($SIZE bytes); keeping but flagging" >&2
	exit 1
fi

# 完整性自检:解密并让 pg_restore 读目录
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASS_FILE" -in "$OUT" \
	| /www/server/pgsql/bin/pg_restore -l > /dev/null

find "$LOCAL_DIR" -name 'easy_training-*.dump.enc' -mtime "+$LOCAL_RETENTION_DAYS" -delete

if mountpoint -q /mnt/cos-backup; then
	mkdir -p "$REMOTE_DIR"
	cp "$OUT" "$REMOTE_DIR/"
	find "$REMOTE_DIR" -name 'easy_training-*.dump.enc' -mtime "+$REMOTE_RETENTION_DAYS" -delete
	echo "backup ok: $OUT ($SIZE bytes), uploaded to COS"
else
	echo "backup ok: $OUT ($SIZE bytes); COS not mounted — LOCAL ONLY" >&2
fi

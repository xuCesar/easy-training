#!/usr/bin/env bash
# #23 隔离恢复演练:解密最新备份 -> 一次性 Postgres 实例(独立 datadir、仅 unix socket)
# -> pg_restore -> 抽样核验 -> 销毁。全程不触碰生产实例与应用凭据。
set -euo pipefail

BIN="/www/server/pgsql/bin"
PASS_FILE="/root/.et-backup-pass"
DRILL_DIR="/var/tmp/et-restore-drill"
SOCKET_DIR="$DRILL_DIR/socket"

LATEST=$(ls -1t /home/ops/et-backups/easy_training-*.dump.enc | head -1)
echo "drill-backup: $LATEST ($(stat -c %s "$LATEST") bytes)"

cleanup() {
	if [ -f "$DRILL_DIR/pgdata/postmaster.pid" ]; then
		su - postgres -c "$BIN/pg_ctl -D $DRILL_DIR/pgdata stop -m immediate" || true
	fi
	rm -rf "$DRILL_DIR"
}
trap cleanup EXIT

rm -rf "$DRILL_DIR"
mkdir -p "$DRILL_DIR" "$SOCKET_DIR"

T0=$(date +%s)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASS_FILE" \
	-in "$LATEST" -out "$DRILL_DIR/restore.dump"
T1=$(date +%s)
echo "decrypt-seconds: $((T1 - T0))"

chown -R postgres:postgres "$DRILL_DIR"
chmod 700 "$DRILL_DIR"

su - postgres -c "$BIN/initdb -D $DRILL_DIR/pgdata --auth=trust" > /dev/null
su - postgres -c "$BIN/pg_ctl -D $DRILL_DIR/pgdata -o \"-k $SOCKET_DIR -c listen_addresses=''\" -w start" > /dev/null
T2=$(date +%s)
echo "instance-up-seconds: $((T2 - T1))"

su - postgres -c "$BIN/createdb -h $SOCKET_DIR drill"
su - postgres -c "$BIN/pg_restore -h $SOCKET_DIR -d drill --no-owner --no-privileges $DRILL_DIR/restore.dump"
T3=$(date +%s)
echo "restore-seconds: $((T3 - T2))"

echo "--- verification"
su - postgres -c "$BIN/psql -h $SOCKET_DIR -d drill -tAc \"SELECT 'tables=' || count(*) FROM information_schema.tables WHERE table_schema='public'\""
su - postgres -c "$BIN/psql -h $SOCKET_DIR -d drill -tAc \"SELECT 'org=' || name FROM organization\""
su - postgres -c "$BIN/psql -h $SOCKET_DIR -d drill -tAc \"SELECT 'campus=' || name || '/' || city FROM campus\""
su - postgres -c "$BIN/psql -h $SOCKET_DIR -d drill -tAc \"SELECT 'users=' || count(*) FROM \\\"user\\\"\""
su - postgres -c "$BIN/psql -h $SOCKET_DIR -d drill -tAc \"SELECT 'members=' || count(*) || ' role=' || string_agg(role::text, ',') FROM organization_member\""

T4=$(date +%s)
echo "total-drill-seconds: $((T4 - T0))"
echo "drill complete; instance destroyed"

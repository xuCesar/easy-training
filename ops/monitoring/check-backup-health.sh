#!/usr/bin/env bash
# 校验最近一次生产备份结果、时效和对应 COS 对象，生成外部拨测状态。
set -euo pipefail

LAST_RESULT_FILE="${BACKUP_HEALTH_RESULT_FILE:-/var/lib/easy-training-monitoring/backup-last-result}"
MOUNT_POINT="${BACKUP_HEALTH_MOUNT_POINT:-/mnt/cos-backup}"
REMOTE_DIR="${BACKUP_HEALTH_REMOTE_DIR:-$MOUNT_POINT/easy-training}"
STATUS_FILE="${BACKUP_HEALTH_STATUS_FILE:-/var/lib/easy-training-monitoring/backup-healthz}"
MAX_AGE_SECONDS="${BACKUP_HEALTH_MAX_AGE_SECONDS:-97200}"

write_status() {
	local content="$1"
	local status_dir
	local temp_file

	status_dir="$(dirname "$STATUS_FILE")"
	install -d -m 0755 "$status_dir"
	temp_file="$(mktemp "${STATUS_FILE}.tmp.XXXXXX")"
	trap 'rm -f "$temp_file"' RETURN
	printf '%s\n' "$content" > "$temp_file"
	chmod 0644 "$temp_file"
	mv -f "$temp_file" "$STATUS_FILE"
	trap - RETURN
}

fail_health() {
	local reason="$1"

	write_status "ALERT"
	printf '{"event":"backup_health.failed","reason":"%s"}\n' "$reason"
	exit 1
}

stat_size() {
	if stat -c "%s" "$1" 2> /dev/null; then
		return
	fi
	stat -f "%z" "$1"
}

if [ ! -f "$LAST_RESULT_FILE" ]; then
	fail_health "result_missing"
fi

result=""
result_timestamp=""
backup_name=""
read -r result result_timestamp backup_name < "$LAST_RESULT_FILE" ||
	fail_health "result_unreadable"

if [ "$result" != "OK" ]; then
	fail_health "last_run_failed"
fi
if [[ ! "$result_timestamp" =~ ^[0-9]+$ ]]; then
	fail_health "timestamp_invalid"
fi
if [[ ! "$backup_name" =~ ^easy_training-[0-9]{8}-[0-9]{6}\.dump\.enc$ ]]; then
	fail_health "backup_name_invalid"
fi

now="$(date +%s)"
if [ "$result_timestamp" -gt "$now" ] ||
	[ $((now - result_timestamp)) -gt "$MAX_AGE_SECONDS" ]; then
	fail_health "result_stale"
fi

if ! mountpoint -q "$MOUNT_POINT"; then
	fail_health "cos_unmounted"
fi

remote_file="$REMOTE_DIR/$backup_name"
if [ ! -f "$remote_file" ]; then
	fail_health "cos_object_missing"
fi
if [ "$(stat_size "$remote_file")" -lt 1024 ]; then
	fail_health "cos_object_too_small"
fi

write_status "OK"

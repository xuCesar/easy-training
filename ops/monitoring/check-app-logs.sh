#!/usr/bin/env bash
# 增量检测生产 PM2 日志，仅对新出现的关键错误生成外部拨测状态。
set -euo pipefail

OUT_LOG="${APP_LOG_OUT_FILE:-/home/deploy/.pm2/logs/easy-training-out.log}"
ERROR_LOG="${APP_LOG_ERROR_FILE:-/home/deploy/.pm2/logs/easy-training-error.log}"
STATE_DIR="${APP_LOG_STATE_DIR:-/var/lib/easy-training-monitoring}"
STATE_FILE="${APP_LOG_STATE_FILE:-$STATE_DIR/app-log-monitor.state}"
STATUS_FILE="${APP_LOG_STATUS_FILE:-$STATE_DIR/log-healthz}"
ALERT_HOLD_SECONDS="${APP_LOG_ALERT_HOLD_SECONDS:-1200}"

out_inode=0
out_offset=0
error_inode=0
error_offset=0
alert_until=0
state_initialized=false

install -d -m 0755 "$STATE_DIR"

write_status() {
	local content="$1"
	local temp_file

	temp_file="$(mktemp "${STATUS_FILE}.tmp.XXXXXX")"
	trap 'rm -f "$temp_file"' RETURN
	printf '%s\n' "$content" > "$temp_file"
	chmod 0644 "$temp_file"
	mv -f "$temp_file" "$STATUS_FILE"
	trap - RETURN
}

write_state() {
	local temp_file

	temp_file="$(mktemp "${STATE_FILE}.tmp.XXXXXX")"
	trap 'rm -f "$temp_file"' RETURN
	{
		printf 'out_inode=%s\n' "$out_inode"
		printf 'out_offset=%s\n' "$out_offset"
		printf 'error_inode=%s\n' "$error_inode"
		printf 'error_offset=%s\n' "$error_offset"
		printf 'alert_until=%s\n' "$alert_until"
	} > "$temp_file"
	chmod 0600 "$temp_file"
	mv -f "$temp_file" "$STATE_FILE"
	trap - RETURN
}

on_error() {
	write_status "ALERT" || true
}
trap on_error ERR

if [[ -f "$STATE_FILE" ]]; then
	state_initialized=true
	while IFS="=" read -r key value; do
		if [[ ! "$value" =~ ^[0-9]+$ ]]; then
			continue
		fi
		case "$key" in
			out_inode) out_inode="$value" ;;
			out_offset) out_offset="$value" ;;
			error_inode) error_inode="$value" ;;
			error_offset) error_offset="$value" ;;
			alert_until) alert_until="$value" ;;
		esac
	done < "$STATE_FILE"
fi

stat_inode() {
	if stat -c "%i" "$1" 2> /dev/null; then
		return
	fi
	stat -f "%i" "$1"
}

stat_size() {
	if stat -c "%s" "$1" 2> /dev/null; then
		return
	fi
	stat -f "%z" "$1"
}

collect_new_content() {
	local log_file="$1"
	local previous_inode="$2"
	local previous_offset="$3"
	local output_file="$4"
	local current_inode
	local current_size
	local start_offset

	: > "$output_file"
	if [[ ! -f "$log_file" ]]; then
		printf '0 0\n'
		return
	fi

	current_inode="$(stat_inode "$log_file")"
	current_size="$(stat_size "$log_file")"
	if [[ "$state_initialized" == "false" ]]; then
		printf '%s %s\n' "$current_inode" "$current_size"
		return
	fi

	start_offset="$previous_offset"
	if [[ "$current_inode" != "$previous_inode" || "$current_size" -lt "$previous_offset" ]]; then
		start_offset=0
	fi
	if [[ "$current_size" -gt "$start_offset" ]]; then
		tail -c "+$((start_offset + 1))" "$log_file" > "$output_file"
	fi
	printf '%s %s\n' "$current_inode" "$current_size"
}

count_matches() {
	local pattern="$1"
	local file="$2"

	grep -Ec "$pattern" "$file" || true
}

count_matches_ignore_case() {
	local pattern="$1"
	local file="$2"

	grep -Eic "$pattern" "$file" || true
}

temp_dir="$(mktemp -d "$STATE_DIR/.app-log-monitor.XXXXXX")"
trap 'rm -rf "$temp_dir"' EXIT
out_new="$temp_dir/out.log"
error_new="$temp_dir/error.log"

read -r out_inode out_offset < <(
	collect_new_content "$OUT_LOG" "$out_inode" "$out_offset" "$out_new"
)
read -r error_inode error_offset < <(
	collect_new_content "$ERROR_LOG" "$error_inode" "$error_offset" "$error_new"
)

critical_event_count="$(count_matches \
	'"event":"(http\.unexpected_error|email\.failed|email\.skipped|lead_import_notification\.failed|operation_task_reminder\.failed|operation_task_reminder\.dead|server\.shutdown_timeout|server\.shutdown_failed)"' \
	"$out_new")"
http_5xx_count="$(count_matches \
	'"event":"http\.access".*"status":5[0-9][0-9]' \
	"$out_new")"
stderr_error_count="$(count_matches_ignore_case \
	'Rate limiting could not determine a client IP|(^|[[:space:]])ERROR([[:space:]:]|$)|Error:|failed|failure|uncaught|unhandled' \
	"$error_new")"

now="$(date +%s)"
new_alert_count=$((critical_event_count + http_5xx_count + stderr_error_count))
if [[ "$new_alert_count" -gt 0 ]]; then
	alert_until=$((now + ALERT_HOLD_SECONDS))
	printf \
		'{"event":"app_log_monitor.alert","criticalEvents":%d,"http5xx":%d,"stderrErrors":%d}\n' \
		"$critical_event_count" \
		"$http_5xx_count" \
		"$stderr_error_count"
fi

write_state
if [[ "$now" -lt "$alert_until" ]]; then
	write_status "ALERT"
else
	write_status "OK"
fi

#!/usr/bin/env bash
# 生成供外部拨测校验的证书到期状态，不输出或复制私钥。
set -euo pipefail

CERT_FILE="${CERT_EXPIRY_CERT_FILE:-/etc/letsencrypt/live/et.eztime-lab.com/fullchain.pem}"
STATUS_FILE="${CERT_EXPIRY_STATUS_FILE:-/var/lib/easy-training-monitoring/cert-expiryz}"
THRESHOLD_SECONDS="${CERT_EXPIRY_THRESHOLD_SECONDS:-2592000}"

write_status() {
	local content="$1"
	local status_dir
	local temp_file

	status_dir="$(dirname "$STATUS_FILE")"
	install -d -m 0755 "$status_dir"
	temp_file="$(mktemp "${STATUS_FILE}.tmp.XXXXXX")"
	trap 'rm -f "$temp_file"' EXIT
	printf '%s\n' "$content" > "$temp_file"
	chmod 0644 "$temp_file"
	mv -f "$temp_file" "$STATUS_FILE"
	trap - EXIT
}

if ! expiry="$(openssl x509 -in "$CERT_FILE" -noout -enddate 2>/dev/null)"; then
	write_status "ERROR certificate_unreadable"
	exit 2
fi

if openssl x509 -in "$CERT_FILE" -noout -checkend "$THRESHOLD_SECONDS" > /dev/null 2>&1; then
	write_status "OK $expiry"
	exit 0
fi

write_status "EXPIRING $expiry"
exit 1

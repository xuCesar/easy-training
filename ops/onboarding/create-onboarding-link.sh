#!/usr/bin/env bash
# 生成机构开通链接(#66)。在生产服务器上执行:
#   bash create-onboarding-link.sh <受邀邮箱> <机构名称> [备注]
# 同邮箱既有的有效开通邀请会被撤销(与应用层语义一致)。
# token 仅在此输出一次,库中只存 sha256。操作记录写入 /home/ops/onboarding.log。
set -euo pipefail

if [ $# -lt 2 ]; then
	echo "usage: $0 <email> <organization-name> [note]" >&2
	exit 1
fi

EMAIL_RAW="$1"
ORG_NAME="$2"
NOTE="${3:-}"
PSQL="/www/server/pgsql/bin/psql"
BASE_URL="https://et.eztime-lab.com"
EXPIRES_DAYS=7

EMAIL=$(printf '%s' "$EMAIL_RAW" | tr '[:upper:]' '[:lower:]' | xargs)
if ! printf '%s' "$EMAIL" | grep -qE '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'; then
	echo "invalid email: $EMAIL_RAW" >&2
	exit 1
fi

APP_URL=$(grep '^APP_DATABASE_URL=' /home/ops/.easy-training-db.env | cut -d= -f2-)
TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')
TOKEN_HASH=$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)

"$PSQL" "$APP_URL" -v ON_ERROR_STOP=1 -q \
	-v email="$EMAIL" -v token_hash="$TOKEN_HASH" \
	-v org_name="$ORG_NAME" -v note="$NOTE" -v days="$EXPIRES_DAYS" <<'SQL'
BEGIN;
UPDATE organization_onboarding_invitation
SET revoked_at = now()
WHERE email_normalized = :'email'
	AND revoked_at IS NULL AND claimed_at IS NULL AND expires_at > now();
INSERT INTO organization_onboarding_invitation
	(email_normalized, token_hash, organization_name, note, expires_at)
VALUES (:'email', :'token_hash', :'org_name', NULLIF(:'note', ''), now() + (:'days' || ' days')::interval);
COMMIT;
SQL

echo "$(date -Is) email=$EMAIL org=$ORG_NAME expires=${EXPIRES_DAYS}d" >> /home/ops/onboarding.log

echo "开通链接(有效期 ${EXPIRES_DAYS} 天,仅显示一次):"
echo "$BASE_URL/onboard#token=$TOKEN"
echo
echo "请连同说明发给 $EMAIL:用该邮箱注册,注册完成自动创建机构\"$ORG_NAME\"。"

#!/usr/bin/env bash
# 机构开通邀请 break-glass 工具。在生产服务器上执行：
#   bash create-onboarding-link.sh [--rotate] <受邀邮箱> <机构名称> [备注]
# 默认不会覆盖待领取邀请；只有显式 --rotate 才会使旧链接立即失效。
# token 仅在标准输出显示一次，数据库和日志只保存 sha256/非敏感摘要。
set -euo pipefail

ROTATE=false
if [ "${1:-}" = "--rotate" ]; then
	ROTATE=true
	shift
fi

if [ $# -lt 2 ]; then
	echo "usage: $0 [--rotate] <email> <organization-name> [note]" >&2
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
if [ -z "$(printf '%s' "$ORG_NAME" | xargs)" ]; then
	echo "organization name is required" >&2
	exit 1
fi

APP_URL=$(grep '^APP_DATABASE_URL=' /home/ops/.easy-training-db.env | cut -d= -f2-)
TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')
TOKEN_HASH=$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)

"$PSQL" "$APP_URL" -v ON_ERROR_STOP=1 -q \
	-v email="$EMAIL" -v token_hash="$TOKEN_HASH" \
	-v org_name="$ORG_NAME" -v note="$NOTE" -v days="$EXPIRES_DAYS" \
	-v rotate="$ROTATE" <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(hashtext(:'email'));

-- 过期记录仍占用“开放邀请”唯一索引槽位，创建前先安全关闭。
UPDATE organization_onboarding_invitation
SET revoked_at = now(), closed_reason = 'expired_superseded'
WHERE email_normalized = :'email'
	AND revoked_at IS NULL
	AND claimed_at IS NULL
	AND expires_at <= now();

SELECT EXISTS (
	SELECT 1
	FROM organization_onboarding_invitation
	WHERE email_normalized = :'email'
		AND revoked_at IS NULL
		AND claimed_at IS NULL
		AND expires_at > now()
) AS has_pending \gset

\set previous_id ''
\if :has_pending
	\if :rotate
		SELECT id AS previous_id
		FROM organization_onboarding_invitation
		WHERE email_normalized = :'email'
			AND revoked_at IS NULL
			AND claimed_at IS NULL
			AND expires_at > now()
		FOR UPDATE
		\gset

		UPDATE organization_onboarding_invitation
		SET revoked_at = now(), closed_reason = 'break_glass_rotated'
		WHERE id = :'previous_id'::uuid;
	\else
		\echo 'pending onboarding invitation already exists; rerun with --rotate only after explicit confirmation'
		\quit 3
	\endif
\endif

SELECT gen_random_uuid() AS request_id \gset
INSERT INTO organization_onboarding_invitation (
	email_normalized,
	token_hash,
	organization_name,
	note,
	request_id,
	replaces_invitation_id,
	expires_at
)
VALUES (
	:'email',
	:'token_hash',
	:'org_name',
	NULLIF(:'note', ''),
	:'request_id'::uuid,
	NULLIF(:'previous_id', '')::uuid,
	now() + (:'days' || ' days')::interval
)
RETURNING id AS invitation_id \gset

\if :rotate
	INSERT INTO platform_audit_event (
		action, source, actor_user_id, entity_type, entity_id, request_id, metadata
	)
	VALUES (
		'onboarding_invitation_rotated',
		'break_glass',
		NULL,
		'organizationOnboardingInvitation',
		:'invitation_id'::uuid,
		:'request_id'::uuid,
		jsonb_build_object('previousInvitationId', :'previous_id')
	);
\else
	INSERT INTO platform_audit_event (
		action, source, actor_user_id, entity_type, entity_id, request_id, metadata
	)
	VALUES (
		'onboarding_invitation_created',
		'break_glass',
		NULL,
		'organizationOnboardingInvitation',
		:'invitation_id'::uuid,
		:'request_id'::uuid,
		jsonb_build_object('emailNormalized', :'email', 'organizationName', :'org_name')
	);
\endif
COMMIT;
SQL

ACTION="created"
if [ "$ROTATE" = true ]; then
	ACTION="rotated"
fi
echo "$(date -Is) action=$ACTION email=$EMAIL org=$ORG_NAME expires=${EXPIRES_DAYS}d" >> /home/ops/onboarding.log

echo "开通链接（有效期 ${EXPIRES_DAYS} 天，仅显示一次）："
echo "$BASE_URL/onboard#token=$TOKEN"
echo
echo "请连同说明发给 $EMAIL：用该邮箱注册，注册完成后自动创建机构“$ORG_NAME”。"

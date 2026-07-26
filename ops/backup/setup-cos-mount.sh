#!/usr/bin/env bash
# 用 /home/ops/.easy-training-cos.env 配置 cosfs 挂载 /mnt/cos-backup(#23)
# 密钥只在服务器上流转:写入 /etc/passwd-cosfs(600, root)
set -euo pipefail

ENV_FILE="/home/ops/.easy-training-cos.env"
MOUNT_POINT="/mnt/cos-backup"
PASSWD_FILE="/etc/passwd-cosfs"

BUCKET=$(grep '^COS_BUCKET=' "$ENV_FILE" | cut -d= -f2-)
REGION=$(grep '^COS_REGION=' "$ENV_FILE" | cut -d= -f2-)
SECRET_ID=$(grep '^COS_SECRET_ID=' "$ENV_FILE" | cut -d= -f2-)
SECRET_KEY=$(grep '^COS_SECRET_KEY=' "$ENV_FILE" | cut -d= -f2-)
URL="https://cos.${REGION}.myqcloud.com"

if ! echo "$BUCKET" | grep -qE '^[a-z0-9-]+-[0-9]+$'; then
	echo "bucket name looks invalid: $BUCKET"; exit 1
fi

umask 077
sudo -n bash -c "umask 077 && printf '%s:%s:%s\n' '$BUCKET' '$SECRET_ID' '$SECRET_KEY' > $PASSWD_FILE"

sudo -n mkdir -p "$MOUNT_POINT"

if ! mountpoint -q "$MOUNT_POINT"; then
	sudo -n cosfs "$BUCKET" "$MOUNT_POINT" -ourl="$URL" -opasswd_file="$PASSWD_FILE" -odbglevel=err
fi

# 开机自动挂载(nofail 防止 COS 不可达时卡启动)
FSTAB_LINE="cosfs#$BUCKET $MOUNT_POINT fuse _netdev,nofail,url=$URL,passwd_file=$PASSWD_FILE,dbglevel=err 0 0"
if ! sudo -n grep -q "cosfs#$BUCKET" /etc/fstab; then
	echo "$FSTAB_LINE" | sudo -n tee -a /etc/fstab > /dev/null
fi

# 读写自检
PROBE="$MOUNT_POINT/.write-probe-$$"
sudo -n bash -c "echo probe > '$PROBE' && cat '$PROBE' && rm '$PROBE'"
echo "cosfs mounted at $MOUNT_POINT (bucket $BUCKET, $REGION), write probe ok"

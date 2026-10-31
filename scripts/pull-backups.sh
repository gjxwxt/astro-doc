#!/usr/bin/env bash
set -euo pipefail

# Pull the server's SQLite/media snapshots to this Mac.
# Example:
#   HALFMU_HOST=root@server.example.com ./scripts/pull-backups.sh
# Keep HALFMU_HOST and HALFMU_KEY in your shell/launchd environment, not in git.
: "${HALFMU_HOST:?请设置 HALFMU_HOST，例如 root@server.example.com}"
HALFMU_KEY="${HALFMU_KEY:-$HOME/Downloads/codex.pem}"
HALFMU_REMOTE_DIR="${HALFMU_REMOTE_DIR:-/opt/josh-portal}"
HALFMU_BACKUP_DIR="${HALFMU_BACKUP_DIR:-$HOME/Backups/halfmu}"

mkdir -p "$HALFMU_BACKUP_DIR"
chmod 700 "$HALFMU_BACKUP_DIR"

echo "→ $HALFMU_HOST:$HALFMU_REMOTE_DIR/backups"
echo "→ $HALFMU_BACKUP_DIR"
ssh -i "$HALFMU_KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 \
  "$HALFMU_HOST" "tar -C '$HALFMU_REMOTE_DIR' -czf - backups" \
  | tar -C "$HALFMU_BACKUP_DIR" -xzf -

echo "✓ 已完成；本地只保留副本，不会删除服务器或旧备份。"

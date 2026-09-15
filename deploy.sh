#!/usr/bin/env bash
# Ships the committed HEAD to the Pi and rebuilds the stack.
# git archive only sends tracked files: no node_modules, build output or local secrets.
set -euo pipefail

PI_USER="${PI_USER:-vince}"
PI_HOST="${PI_HOST:-192.168.1.15}"
REMOTE_DIR="${REMOTE_DIR:-/home/${PI_USER}/propre-labs}"

if [ -n "$(git status --porcelain)" ]; then
  echo "WARNING: uncommitted changes are NOT deployed (git archive ships HEAD only)."
fi

echo "==> Shipping $(git rev-parse --short HEAD) to ${PI_USER}@${PI_HOST}:${REMOTE_DIR}"
git archive --format=tar HEAD | ssh "${PI_USER}@${PI_HOST}" "mkdir -p '${REMOTE_DIR}' && tar -x -C '${REMOTE_DIR}'"

echo "==> Building and starting containers on Pi..."
ssh "${PI_USER}@${PI_HOST}" "REMOTE_DIR='${REMOTE_DIR}' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"

if [ ! -f .env ]; then
  echo "ERROR: .env not found on Pi. Create it from .env.example first."
  exit 1
fi

docker compose pull cloudflared
docker compose up -d --build

echo "==> Containers:"
docker compose ps
REMOTE

echo ""
echo "==> Deploy complete. Check https://propre-labs.com"

#!/usr/bin/env bash
set -euo pipefail

PI_USER="${PI_USER:-vince}"
PI_HOST="${PI_HOST:-192.168.1.12}"
REMOTE_DIR="${REMOTE_DIR:-/home/${PI_USER}/propre-labs}"

echo "==> Syncing project to Pi..."
rsync -avz --exclude 'node_modules' --exclude 'dist' --exclude '.git' --exclude '.ssh' --exclude '.claude' \
  ./ "${PI_USER}@${PI_HOST}:${REMOTE_DIR}/"

echo "==> Building and starting containers on Pi..."
ssh "${PI_USER}@${PI_HOST}" bash -s <<'REMOTE'
set -euo pipefail
cd /home/vince/propre-labs

# Ensure .env exists
if [ ! -f .env ]; then
  echo "ERROR: .env not found on Pi. Create it from .env.example first."
  exit 1
fi

# Build & restart
docker compose pull cloudflared
docker compose up -d --build

echo "==> Containers:"
docker compose ps
REMOTE

echo ""
echo "==> Deploy complete. Check https://propre-labs.com"

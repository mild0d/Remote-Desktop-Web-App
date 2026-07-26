#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "No .env found. Run ./setup.sh first."
  exit 1
fi

docker compose up -d
APP_PORT=$(grep '^APP_PORT=' .env | cut -d= -f2)
echo "Started. Visit https://localhost:${APP_PORT:-8080}"

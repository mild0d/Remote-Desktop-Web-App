#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "== RDP Web App - Setup =="

if ! command -v docker &> /dev/null; then
  echo "Docker is not installed."
  read -p "Attempt to install Docker automatically now? [y/N] " yn
  case "$yn" in
    [Yy]*)
      curl -fsSL https://get.docker.com | sh
      ;;
    *)
      echo "Please install Docker (and the Docker Compose plugin) manually, then re-run this script."
      exit 1
      ;;
  esac
fi

if ! docker compose version &> /dev/null; then
  echo "Docker Compose plugin not found. Please install it (it usually ships with modern Docker) and re-run."
  exit 1
fi

if [ ! -f .env ]; then
  echo "Generating .env with fresh secrets..."
  cp .env.example .env

  APP_SECRET_KEY=$(openssl rand -hex 16)
  GUAC_CRYPT_KEY=$(openssl rand -hex 16)
  SESSION_SECRET=$(openssl rand -hex 32)

  sed -i.bak "s/^APP_SECRET_KEY=.*/APP_SECRET_KEY=${APP_SECRET_KEY}/" .env
  sed -i.bak "s/^GUAC_CRYPT_KEY=.*/GUAC_CRYPT_KEY=${GUAC_CRYPT_KEY}/" .env
  sed -i.bak "s/^SESSION_SECRET=.*/SESSION_SECRET=${SESSION_SECRET}/" .env
  rm -f .env.bak
else
  echo ".env already exists, leaving it untouched."
fi

mkdir -p data

echo "Building and starting containers..."
docker compose up -d --build

APP_PORT=$(grep '^APP_PORT=' .env | cut -d= -f2)
echo
echo "Setup complete!"
echo "Open: https://localhost:${APP_PORT:-8080}"
echo "(Your browser will show a security warning the first time - this is expected, since it's a self-signed certificate. Click through/accept it.)"
echo "Register an account on first visit to get started."

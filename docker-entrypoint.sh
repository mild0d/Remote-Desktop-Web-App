#!/bin/sh
# Runs briefly as root (the container's default user) purely to fix
# ownership of the mounted volumes, then drops to the unprivileged 'node'
# user (built into the official node:*-alpine images) before actually
# starting the app. This handles both a fresh install (where Docker may
# have created these paths as root) and an existing install upgrading from
# before this change (where ./data was already created under the old
# always-root behavior) - without requiring you to manually chown anything
# on the host yourself.
set -e

chown -R node:node /app/data /app/drive-data /app/backups 2>/dev/null || true

exec su-exec node "$@"

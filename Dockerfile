FROM node:26-alpine

# Belt-and-suspenders alongside the explicit global error handler in
# server.js - Express's own default error handler (which would only ever
# fire if something slipped past that handler somehow) includes a full
# stack trace in the response unless this is explicitly "production".
ENV NODE_ENV=production

# su-exec is the standard, lightweight Alpine tool for dropping from root to
# another user before exec'ing the final process - much smaller than gosu,
# and the normal recommended approach for Alpine-based images specifically.
RUN apk add --no-cache su-exec

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Created here (rather than relying solely on Docker's automatic mount-point
# creation) so they exist with sane ownership even before any volume gets
# attached - the entrypoint script re-asserts ownership at every container
# start anyway, which is what actually matters once the real volumes mount.
RUN mkdir -p /app/data /app/drive-data /app/backups && chown -R node:node /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

# Runs as root only long enough for the entrypoint script to fix volume
# ownership, then drops to the unprivileged 'node' user - the actual app
# process never runs as root.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]

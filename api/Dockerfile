# anydag-api's image. The build context is `api/dist/` — what
# `node api/build.mjs` writes: the bundle, the migrations and a package.json naming PGlite alone —
# so `npm run api:build` comes first, and the image never sees the repository, its node_modules or
# a .env (`api/compose.yaml` and `npm run api:up` do both).
#
# Load-bearing: it runs as `node`, not root, and owns only /data; it listens on 0.0.0.0 because a
# container's loopback is not the host's (compose publishes it on 127.0.0.1 only); and the
# healthcheck is /v1/health, the one route that needs no token.
FROM node:24-alpine

ENV NODE_ENV=production \
    ANYDAG_SYNC_HOST=0.0.0.0 \
    ANYDAG_SYNC_PORT=8790 \
    ANYDAG_SYNC_DATA=/data

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY migrations/ ./migrations/
COPY anydag-api.mjs ./

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8790

HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=10 \
  CMD wget -qO- "http://127.0.0.1:${ANYDAG_SYNC_PORT}/v1/health" >/dev/null || exit 1

ENTRYPOINT ["node", "/app/anydag-api.mjs"]
CMD ["serve"]

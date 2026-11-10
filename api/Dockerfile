# anydag-api's image. The build context is `api/` itself — `docker build api/`, which `npm run
# api:up` and `deploy/compose.yaml` both do — and `api/.dockerignore` keeps everything out of it
# but `dist/`: `node api/build.mjs`'s output, the bundle, the migrations and a package.json naming
# PGlite alone. So `npm run api:build` comes first, and no `.env*`, `*.local`, data directory or
# node_modules ever enters the build — the context carries no file a secret could hide in, and no
# build argument ever would.
#
# Load-bearing: it runs as `node`, not root, and owns only /data; it listens on 0.0.0.0 because a
# container's loopback is not the host's (compose publishes it on 127.0.0.1 only); and its own
# healthcheck is /v1/health. A deployment healthchecks /v1/ready, which asks the database too
# (deploy/compose.yaml says so).
FROM node:24-alpine

ENV NODE_ENV=production \
    ANYDAG_API_HOST=0.0.0.0 \
    ANYDAG_API_PORT=8790 \
    ANYDAG_API_DATA=/data

WORKDIR /app
COPY dist/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY dist/migrations/ ./migrations/
COPY dist/anydag-api.mjs ./

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8790

HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=10 \
  CMD wget -qO- "http://127.0.0.1:${ANYDAG_API_PORT}/v1/health" >/dev/null || exit 1

ENTRYPOINT ["node", "/app/anydag-api.mjs"]
CMD ["serve"]

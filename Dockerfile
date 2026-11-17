# syntax=docker/dockerfile:1
# Taskmaster: one Node server + SQLite file on the /data volume (spec §8, §11).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml .npmrc ./
# Install scripts run only for packages in pnpm.onlyBuiltDependencies; `prepare` skips lefthook without .git.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
# DATA_DIR: where the app keeps its SQLite file (mount a persistent volume here).
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
# Nitro bundles the server and its traced dependencies into .output; no node_modules needed.
COPY --from=build --chown=node:node /app/.output ./.output
# SQL migrations, applied by the server at boot (#16). Root-owned: the app only reads them.
COPY --from=build /app/drizzle ./drizzle
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", ".output/server/index.mjs"]

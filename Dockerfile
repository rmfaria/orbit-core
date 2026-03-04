# orbit-core
# SPDX-License-Identifier: Apache-2.0

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN npm install -g pnpm@9

WORKDIR /build

# Copy manifests first — layer cache hit when only source changes
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/api/package.json            ./packages/api/
COPY packages/ui/package.json             ./packages/ui/
COPY packages/storage-pg/package.json     ./packages/storage-pg/
COPY packages/engine/package.json         ./packages/engine/
COPY packages/core-contracts/package.json ./packages/core-contracts/
COPY packages/nagios-shipper/package.json ./packages/nagios-shipper/

RUN pnpm install --frozen-lockfile

# Build all packages
COPY packages/ ./packages/
RUN pnpm build

# Create self-contained deployment directories using pnpm deploy.
# This resolves all workspace symlinks and copies workspace package dist/ files
# into node_modules/ without symlinks — safe for Docker COPY.
RUN pnpm --filter @orbit/api      deploy --prod /deploy/api
RUN pnpm --filter @orbit/storage-pg deploy --prod /deploy/storage-pg

# ── Stage 2: api runtime ──────────────────────────────────────────────────────
FROM node:22-alpine AS api

WORKDIR /app

# Self-contained API deployment (dist/ + node_modules with workspace deps resolved)
COPY --from=builder /deploy/api .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

CMD ["node", "--max-old-space-size=384", "dist/index.js"]

# ── Stage 3: migrate runner ───────────────────────────────────────────────────
# storage-pg deploy includes dist/migrate.js and migrations/ directory.
FROM node:22-alpine AS migrate

WORKDIR /app

COPY --from=builder /deploy/storage-pg .

CMD ["node", "dist/migrate.js"]

# ── Stage 4: ui (nginx) ───────────────────────────────────────────────────────
FROM nginx:alpine AS ui

COPY --from=builder /build/packages/ui/dist /usr/share/nginx/html
COPY deploy/nginx-standalone.conf /etc/nginx/conf.d/default.conf
COPY deploy/certs/ /etc/nginx/certs/

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- --no-check-certificate https://127.0.0.1/orbit-core/ || exit 1

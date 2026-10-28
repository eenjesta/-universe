# syntax=docker/dockerfile:1
# Ø Universe — one container: the built web client + the Node game server (WebSocket /ws,
# /healthz, persistence). See docs/DEPLOY.md (Railway) and PLATFORM.md §5.
#
#   docker build -t o-universe .
#   docker run -p 8080:8080 -v o-universe-data:/data o-universe     → http://localhost:8080

# ---------------------------------------------------------------- 1. build the client (dev deps)
FROM node:26-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------------------------------------------------------------- 2. production dependencies only
FROM node:26-slim AS deps
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------- 3. runtime
FROM node:26-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
# the server, the shared protocol/simulation, and the client sources the server imports
# (terrain bake: src/world/terrain + src/world/layout.js + src/core noise/math/i18n). All of
# src/ is copied (~4 MB) so a new import in the sim or terrain code can't break the image.
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --chown=node:node src ./src
COPY --from=build --chown=node:node /app/dist ./dist
# DATA_DIR: JSON saves + the terrain cache. Mount a volume here (Railway: mount path /data,
# and set RAILWAY_RUN_UID=0 because Railway volumes are root-owned) or use Postgres (DATABASE_URL).
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "server/index.js"]

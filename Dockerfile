# syntax=docker/dockerfile:1

# =============================================================================
# SportsRelay — modern HLS proxy for sportsbite.org (Next.js 16)
#
# Multi-stage build:
#   deps    — resolves the full dependency tree from bun.lock
#   builder — compiles the Next.js app with `output: "standalone"`
#   runner  — minimal Node.js image carrying ONLY the traced standalone output
#
# Build:  docker build -t sportsrelay .
# Run:    docker run -p 3000:3000 sportsrelay
# =============================================================================

ARG BUN_VERSION=1.3
ARG NODE_VERSION=22

# ---------------------------------------------------------------- deps -------
FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app

# Copy only what dependency resolution needs so this layer stays cacheable.
COPY package.json bun.lock ./
COPY prisma ./prisma

# Prisma client must be generated before any bundling; the app itself does
# not use the database today, but generating here keeps the template usable.
RUN bun install --frozen-lockfile && bunx prisma generate

# ------------------------------------------------------------- builder -------
FROM oven/bun:${BUN_VERSION}-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `bun run build` = next build (standalone) + copies .next/static and public
# into .next/standalone so the runner only needs one directory.
RUN bun run build

# -------------------------------------------------------------- runner -------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

LABEL org.opencontainers.image.title="SportsRelay" \
      org.opencontainers.image.description="Modern Next.js HLS video proxy for the sportsbite.org public sports API" \
      org.opencontainers.image.source="https://sportsbite.org/api"

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# The standalone bundle already embeds server.js, the traced node_modules,
# .next/static and public (copied by the build script).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Belt-and-braces: re-copy static/public in case the build script changes.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

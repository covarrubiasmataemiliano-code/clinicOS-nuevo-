# wacrm (clinic-os-lite-new) — imagen de deploy para el VPS (Dokploy).
# Dockerfile determinista (evita el flake de Nixpacks con el pin de nixpkgs).
#
# Multi-stage: deps → build → runtime standalone (~200MB, vs ~2GB con
# node_modules completo — importa en un VPS compartido de 4GB).
#
# Dokploy inyecta las env vars del servicio como --build-arg; hay que
# declararlas como ARG→ENV o `next build` no las ve (los NEXT_PUBLIC_* se
# inlinean en el bundle, y algunas páginas instancian el cliente Supabase
# al prerender). SOLO los NEXT_PUBLIC_* se consumen en build: los secretos
# runtime (SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, META_APP_SECRET…)
# NO deben declararse como ARG — quedarían horneados en las capas de la
# imagen y cualquiera con acceso a ella podría extraerlos.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    # lib/whatsapp/* lee estas en module-load durante `next build`
    # (recolección de datos de páginas). Placeholders solo de build;
    # en runtime las reemplazan las env vars reales del contenedor.
    ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
    META_APP_SECRET=build-placeholder \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd -g 1001 nodejs && useradd -m -u 1001 -g nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs

EXPOSE 3000
CMD ["node", "server.js"]

# wacrm (clinic-os-lite-new) — imagen de deploy para el VPS de pruebas.
# Dockerfile determinista (evita el flake de Nixpacks con el pin de nixpkgs).
# Dokploy inyecta las env vars del servicio como ENV en el build, así que los
# NEXT_PUBLIC_* quedan inlineados por `next build`.
FROM node:22-slim

WORKDIR /app

# deps primero (capa cacheable)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# código + build
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]

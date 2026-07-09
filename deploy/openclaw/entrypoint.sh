#!/bin/sh
# ============================================================
# Entrypoint git-driven del gateway OpenClaw — agentes COCO + NUGGET.
# Copia writable de cada workspace (OpenClaw escribe .openclaw dentro),
# escribe el openclaw.json versionado (secret-free) y arranca el gateway.
# ============================================================
set -e
CFG="${HOME:-/home/node}/.openclaw"
mkdir -p "$CFG/ws-coco" "$CFG/agents/coco/agent" "$CFG/ws-nugget" "$CFG/agents/nugget/agent"

if [ -d /workspaces/coco ]; then
  cp -a /workspaces/coco/. "$CFG/ws-coco/" 2>/dev/null || true
else
  echo "[entrypoint] WARN /workspaces/coco no montado — Coco sin persona."
fi

if [ -d /workspaces/nugget ]; then
  cp -a /workspaces/nugget/. "$CFG/ws-nugget/" 2>/dev/null || true
else
  echo "[entrypoint] WARN /workspaces/nugget no montado — Nugget sin persona."
fi

cp /openclaw-config/config.json "$CFG/openclaw.json"
echo "[entrypoint] config Coco+Nugget aplicada; arrancando gateway..."
exec node openclaw.mjs gateway --allow-unconfigured

# ClinicOS SaaS — Consolidación + fixes críticos

Repo limpio consolidado a partir de **ClinicOS** (base) + lo aprovechable de
**Aria**. Pensado para subir a un **servidor de pruebas** y evolucionar a SaaS.
Los repos de producción (Aria / clinic-os) NO se tocaron.

## Diagnóstico (por qué ClinicOS "se saltaba pasos" y "perdía el estado")

1. El cerebro conversacional corría por defecto en `deepseek-v4-flash` (el más
   barato) contra un protocolo de agendamiento de ~20 reglas en el prompt.
2. El embudo de cita dependía de prosa del prompt + lógica duplicada en dos
   archivos (riesgo de divergencia).
3. Sin `DATABASE_URL` el engine caía a estado en memoria → se perdía al reiniciar.

> "Pierde el hilo" NO era un bug: el webhook YA tiene buffer de ráfagas
> (`LATEST_INBOUND`) y candado por conversación (`AGENT_RUNNING`/`AGENT_RERUN`).
> Eso quedó intacto.

## Qué cambió

### 1. Modelo robusto por defecto + red de fallback (de Aria)
- `apps/engine/src/agents/model.ts`: el default conversacional pasó de DeepSeek a
  **Claude Sonnet** (configurable por clínica con `config.modelo` / `AGENT_MODEL`;
  DeepSeek queda como tier económico EXPLÍCITO). Visión sigue barata.
- `apps/engine/src/agents/model-fallback.ts` (NUEVO): cadena de fallback portada
  de Aria (`src/lib/llm.js`). Ante 429/503/402/… reintenta con el siguiente
  modelo. Se configura con `AGENT_FALLBACK_MODELS`. Integrada en `runAgentTurn`
  (`agent-core.ts`) y en el extractor CRM.

### 2. Embudo de cita robusto en CÓDIGO
- `apps/engine/src/agents/funnel.ts` (NUEVO): **fuente única** de `FUNNEL_RANK` +
  regla "solo avanza" (`canAdvanceClassification`). Antes estaba DUPLICADA en
  `tools.ts` y `recepcionista.ts`. Ahora ambos la importan.
- `apps/engine/src/agents/tools.ts`: `confirmar_anticipo` ahora **valida la
  precondición** — si no hay una cita pendiente real, devuelve `ok:false` y manda
  a `crear_cita` primero (impide saltarse ese paso). Idempotente si ya estaba
  confirmada. El avance del embudo ya lo fijan las acciones reales (no el modelo).

### 3. Durabilidad y limpieza
- `apps/engine/src/server.ts`: **fail-fast en producción** — aborta el arranque
  si falta `DATABASE_URL` o una llave de IA (antes degradaba en silencio a memoria).
- `apps/engine/.env.example`: consolidado (NODE_ENV, modelos, fallback, visión).
- Seed demo ya estaba aislado tras `SEED_DEMO=true`; el path de prod es
  `emptyState()` + CLI `create-clinic`.

## Verificación hecha
- `tsc --noEmit` engine + contracts: OK.
- Tests: engine **73/73**, mocks **286/286**.

## Roadmap pendiente (no bloquea el servidor de pruebas)

- **F2 — modelo relacional:** migrar el estado KV-blob (`db.state.*` → `PgStore`)
  a tablas relacionales con transacciones, usando el `schema.prisma` de Aria como
  blueprint. Mejora auditoría/concurrencia para datos de pacientes.
- Extender la cadena de fallback a `pacientes.ts` y `concierge-llm.ts` (hoy solo
  recepcionista; es trivial: pasar `fallbackModels` de `resolveAgentModelChain`).
- Backlog de seguridad ya conocido (firma `X-Hub-Signature-256` del webhook,
  auth en `/media/:id`, rate-limiting) — ver `CLAUDE.md` › Gotchas.

## Cómo correr en el servidor de pruebas
```bash
corepack pnpm install          # Node 22 recomendado (pnpm 11); Node 20 → usa pnpm 10
cp apps/engine/.env.example apps/engine/.env   # rellena DATABASE_URL + llave IA
corepack pnpm --filter @clinicos/engine dev    # engine :3001
```
En prod (`NODE_ENV=production`) el engine exige `DATABASE_URL` + llave de IA.

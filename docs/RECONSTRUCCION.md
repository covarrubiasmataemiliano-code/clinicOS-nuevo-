# clinicOS 0.3 — Análisis de reconstrucción y plan

*Julio 2026. Documento vivo: análisis de la base (wacrm) y del legacy (ClinicOS 2.0),
decisión de arquitectura de agentes y roadmap.*

## 1. Contexto

clinicOS automatiza la atención al cliente de clínicas vía WhatsApp (atender, agendar,
calificar leads, cobrar anticipos) y el panel administrativo con un agente concierge para
el doctor/equipo médico. La versión anterior acumuló problemas conversacionales; se
decidió reconstruir sobre una base validada:

- **Base**: fork de **wacrm** (`stratumcompanyai-crypto/ARIA`, upstream @ 274db1c) —
  CRM WhatsApp self-hosteable, Next.js 16 + Supabase. Copiado a este repo como commit
  baseline. 593/593 tests en verde, typecheck limpio.
- **Del legacy** (`DevAI-MX/ClinicOS-c-digo-limpio-2.0`) solo se rescata contexto de
  negocio, prompts/directrices de venta y el diseño de UI → ver `docs/legacy-clinicos/`.

## 2. Qué nos da la base (wacrm)

Ya resuelto y probado — no hay que construirlo:

- **WhatsApp Cloud API completo**: webhook con firma HMAC verificada, entrantes de todo
  tipo (media, botones, reacciones, replies), salientes, templates de Meta con ciclo de
  vida, estados de entrega (`src/lib/whatsapp/`, `src/app/api/whatsapp/`).
- **CRM**: contactos + tags + custom fields + notas, dedupe por teléfono, pipelines
  Kanban con deals (`supabase/migrations/001…`).
- **Inbox multi-agente humano** con asignación, roles (owner/admin/agent/viewer),
  cuentas multi-tenant con RLS en todas las tablas.
- **Automatizaciones no-code** (triggers/condiciones/waits/webhooks) y **Flows**
  (chatbot determinista visual) — los deterministas ganan sobre el LLM: orden de
  despacho del webhook es Flows → automations → IA.
- **Capa de IA lista para extender**: auto-reply bot por cuenta (BYO key
  OpenAI/Anthropic cifrada), knowledge base con retrieval híbrido (full-text +
  pgvector), cap de respuestas por conversación (RPC atómico `claim_ai_reply_slot`),
  handoff a humano sticky, playground de pruebas (`src/lib/ai/`).
- **API pública** `/api/v1` con API keys hasheadas y scopes + webhooks salientes
  firmados.

**Limitación clave**: la IA actual es una sola completación de texto — **no tiene
tool-calling**. Convertir `src/lib/ai/generate.ts` en un loop de tool-use es el corazón
del trabajo nuevo.

## 3. Qué le falta a la base para ser clinicOS (net-new)

1. **Agenda/citas**: tablas de citas, disponibilidad (`DoctorSchedule` del legacy como
   guía), sync con Google Calendar. No existe nada de esto en wacrm.
2. **Anticipos/pagos**: modelo `Payment` + `depositStatus` + regla de oro del legacy
   (la IA prevalida el comprobante por visión, **un humano confirma el dinero**, y solo
   entonces la cita se confirma). Sin pasarela por ahora: transferencia + links.
3. **Expediente ligero**: sobre `contacts` + custom fields al inicio; expediente
   clínico completo después.
4. **El agente clínico con tools** (ver §4) y el **concierge** interno.
5. **UI clinicOS**: tema porcelana/grafito + azul petróleo, bandeja 3 columnas, kanban,
   agenda — port progresivo desde `docs/legacy-clinicos/ui/` y screenshots.

## 4. Decisión de arquitectura: ¿multi-agente o agente único?

**Recomendación: dos agentes separados por frontera de confianza — ni un enjambre
multi-agente, ni un solo agente que haga todo.**

| | Agente de Atención (WhatsApp) | Agente Concierge (panel interno) |
|---|---|---|
| Habla con | Pacientes y leads (público, no confiable) | Doctor y equipo (autenticados) |
| Tools | Pocas y **contact-scoped**: solo puede actuar sobre el contacto de SU conversación (agendar, prevalidar anticipo, clasificar, escalar) | Amplias y **clinic-scoped**: leer/escribir en toda la clínica (agenda, CRM, finanzas, documentos) |
| Riesgo | Prompt injection desde WhatsApp → por eso sus tools no pueden tocar nada fuera de su contacto | Acciones potentes → confirmación humana para dinero y borrados |

**Por qué no UN solo agente para todo**: cualquier persona en WhatsApp podría intentar
inyectarle instrucciones; si ese mismo agente tiene poderes de escritura sobre toda la
clínica, una inyección exitosa es catastrófica. El propio legacy documentó este riesgo
(spec de RAG injection). La separación es de seguridad, no de moda.

**Por qué no un enjambre multi-agente**: el legacy ya lo intentó parcialmente (router
recepcionista/pacientes + 5 agentes solo-config) y los problemas conversacionales NO
venían de tener pocos agentes, sino de: ventana de memoria de 20 mensajes, modelo débil
(DeepSeek) frente a 20 reglas en prosa, concurrencia hand-rolled y guards post-hoc
parchando alucinaciones. Más agentes = más handoffs = más puntos donde perder el hilo.
Dentro de cada frontera, **un solo agente con buenas tools y buen modelo** es más
robusto que varios coordinándose.

Las tareas puntuales (sugerencias de respuesta, OCR, nota SOAP) no son "agentes":
son llamadas LLM de función única, sin loop, y se añaden cuando toquen.

**Principios heredados del legacy que SÍ se conservan** (son sus mejores ideas):
- Embudo de leads **en código**, no en el prompt (`funnel.ts`): los estados duros los
  fijan acciones reales (tool ejecutada), nunca la "opinión" del modelo.
- Tools tipadas y estrechas (fix explícito del tool-calling roto de la generación previa).
- Regla de oro del anticipo: la IA nunca confirma pagos ni citas; prevalida y un humano
  aprueba.
- Determinismo primero: Flows/automations de wacrm manejan lo repetitivo; el LLM solo
  entra donde hace falta conversación real.

**Qué se corrige del legacy**:
- Memoria: historial relevante completo + resumen rodante persistido, no `slice(-20)`.
- Modelo: Claude Sonnet como cerebro conversacional desde el día 1.
- Concurrencia: el buffer de ráfagas y el candado por conversación se apoyan en
  Postgres (estado durable), no en `Set`s en memoria.
- Menos guards post-hoc: con tool-calling nativo bien tipado y modelo capaz, la mayoría
  de esos parches sobran; se conservan como red de seguridad, no como mecanismo primario.

## 5. Roadmap propuesto

- **F0 — Base operativa** ✅: fork montado, deps, tests, `.env.local` esqueleto.
  *Pendiente del usuario*: proyecto Supabase (aplicar las 30 migraciones) + app de Meta
  (`META_APP_SECRET`, número WABA).
- **F1 — Dominio clínico en Supabase**: migraciones nuevas para citas, disponibilidad,
  pagos/anticipos, procedimientos/catálogo (usar `docs/legacy-clinicos/contratos/` como
  guía de modelo). RLS igual que el resto (por `account_id`).
- **F2 — Agente de Atención**: loop de tool-use en `src/lib/ai/` (Anthropic tool use),
  tools contact-scoped (consultar catálogo/disponibilidad, crear cita, prevalidar
  anticipo, clasificar lead, escalar), prompts desde
  `docs/legacy-clinicos/agentes/recepcionista.ts` + seeds, embudo en código, knowledge
  base de wacrm como contexto de clínica. Probar en el playground `/agents`.
- **F3 — Panel clinicOS**: aplicar el tema (`globals.css` legacy) y portar módulo por
  módulo: inbox 3 columnas → agenda → kanban CRM → expediente. Los datos ya viven en
  Supabase (React Query/Realtime en lugar del DataProvider legacy).
- **F4 — Concierge**: agente interno con tools clinic-scoped sobre las mismas tablas,
  confirmación humana para acciones sensibles.
- **F5 — Pulido de venta**: directrices por clínica (seeds), sugerencias del inbox,
  broadcasts/recordatorios de cita con templates.

Cada fase se valida end-to-end antes de pasar a la siguiente (el legacy sufrió por
construir ancho antes que profundo).

## 6. Riesgos a vigilar

- El webhook procesa en `after()` con `maxDuration=60`: un turno de agente con varias
  tools puede acercarse al límite → si pasa, mover a cola/worker.
- Rate limiter de la API pública en memoria por proceso → Redis si hay multi-instancia.
- Un número de WhatsApp por cuenta (`whatsapp_config UNIQUE(account_id)`) → relajar si
  una clínica necesita varias líneas.
- Next.js 16 tiene breaking changes: consultar `node_modules/next/dist/docs/` antes de
  escribir código (advertencia del propio upstream en `AGENTS.md`/`CLAUDE.md`).

# Agentic-ERP — arquitectura V0 y operación

> La info de cada departamento se conglomera en **profiles de entidad** y el sistema se
> retroalimenta (flywheel). Diseño construido en la rama `feat/agentic-erp-v0`.

## La espina

```
WhatsApp / Calendar / Drive   = edges (ingest evento+asset / project)
        │  ▲
        ▼  │
  EVENT LOG (hechos estructurados)     ASSET STORE (binarios, FS→MinIO)
        │  ingesta emite eventos ◄─────┘  + embeddings → memoria por-entidad
        ▼
  PROFILES (patient / doctor / procedure / clinic)  = proyecciones síncronas
        │  lee ▲ emite
        ▼      │
  AGENTES (Sherlock orquestador · recepcionista · copiloto · Kika)
```

- **Event log** (`events` domain): hecho de dominio append-only = fuente de verdad de los "ledger"
  (lead, citas, pagos, clínico, feedback, assets). `emit` re-proyecta de forma **síncrona** los
  profiles afectados (decisión B). Trabajo pesado/externo (ingesta, push, Calendar) va a cola aparte.
- **Profiles** (`profiles` domain): 4 proyecciones (patient/doctor/procedure/clinic) agregadas del
  fold del estado + eventos. Las leen agentes (contexto) y humanos (dashboards).
- **Assets** (`assets` domain): registro canónico de binarios; bytes en `AssetStore` (FS hoy, MinIO
  en deploy), **nunca** en el contrato/JSONB. Se sirven por el engine con capability tokens (PHI).

## Decisiones cerradas (2026-06-21)

A) event-sourcing híbrido ledger-vs-register. B) proyección síncrona; pesado a cola. C) jobs con
**pg-boss** sobre Postgres (no Vercel Workflow, no BullMQ). D) memoria pgvector extendida con
`entity_type`/`entity_id`. Storage: **MinIO en el VPS** (bytes nunca en JSONB), servido por el engine
con tokens. **Per-cliente = config/flags runtime, nunca ramas de código** (becerril = default).

## Flags por-cliente (runtime, sin rebuild salvo NEXT_PUBLIC_*)

| Flag | Default (becerril) | Qué hace |
|---|---|---|
| `CONCIERGE_NAME` (engine) | `Sherlock` | Nombre del concierge en prompts. Oranza: `Naird`. |
| `NEXT_PUBLIC_CONCIERGE_NAME` (web, **build-time**) | `Sherlock` | Nombre en la UI. Mantener en sintonía con el de engine. |
| `CONCIERGE_REMINDERS` | `true` | Worker proactivo (cita próxima + resumen del día). |
| `PUSH_ALL_INBOUND` | `false` | `false`: push solo cuando un humano debe contestar (IA no activa). `true`: push de TODO mensaje entrante (awareness total) — útil al inicio mientras el equipo confía en la IA. |
| `WA_AGENT_AUTOREAD` | `false` | `false` (default): el agente NO marca leído en Meta → preserva las notificaciones del WhatsApp del celular (coexistencia; Meta acopla "leído"+"escribiendo…"). `true`: muestra "visto"/"escribiendo…" al cliente, pero el cel deja de notificar — activar solo cuando el equipo ya opera dentro de ClinicOS y confía en su push/cola "Pendientes". |
| `STRICT_AVAILABILITY` | `true` | `true`: anticipo pendiente bloquea el hueco; `false` (oranza): no bloquea. |
| `ENABLE_CONTACT_DELETION` | `false` | Borrado en cascada (destructivo). **Default OFF — a discutir.** |
| `ASSETS_DIR` | `/data/assets` | Directorio FS de assets (volumen persistente). |
| `ASSET_STORE` / `MINIO_*` | — | Upgrade a MinIO (ver abajo). |

## V0 vs upgrades

- **V0 (hecho):** event log + 4 profiles vía colecciones del estado (persistidas al KV); assets en
  **filesystem**; ingesta **best-effort inline** (reusa llaves IA existentes; sin llaves degrada).
- **Upgrades (additivos, sin cambiar contrato):** tabla `clinicos_events` dedicada + pg-boss;
  `MinioAssetStore`; memoria por-entidad con embeddings; registry unificado de tools.

## Guía Dokploy — paso a paso

> El despliegue es **por-cliente** (un app Compose por clínica). Estos pasos asumen que la app ya
> existe en Dokploy (ver `docs/ONBOARDING-CLIENTE.md`). **No** despliegues a un VPS de cliente sin
> autorización (lleva PHI).

### A. Variables de entorno (panel de Dokploy)

1. Abre la app del cliente → pestaña **Environment**.
2. Añade/ajusta según la clínica (los defaults ya quedan en el compose, solo overrides):
   - `CONCIERGE_NAME` (p. ej. `Naird` para oranza) y, si difiere, `NEXT_PUBLIC_CONCIERGE_NAME`.
   - `CONCIERGE_REMINDERS=false` si la clínica no quiere avisos proactivos (oranza).
   - `STRICT_AVAILABILITY=false` para la regla "sin anticipo no bloquea" (oranza).
   - `ENABLE_CONTACT_DELETION=true` solo si la clínica lo pidió explícitamente.
3. **Nota build-time:** `NEXT_PUBLIC_CONCIERGE_NAME` se incrusta al construir la imagen web. Para que
   tome efecto hay que **Redeploy con rebuild** (no basta reiniciar). El resto son runtime (reinicio).

### B. Volumen de assets (persistencia de binarios)

1. El `dokploy-compose.yml` ya declara el volumen `clinicos-data` montado en `/data` del engine, con
   `ASSETS_DIR=/data/assets`. Dokploy crea el volumen named automáticamente al desplegar.
2. Verifica en **Volumes** que `clinicos-data` aparezca tras el primer deploy. Inclúyelo en tu rutina
   de respaldo (snapshot del volumen + dump de Postgres).

### C. (Upgrade) MinIO como object storage

> Solo cuando se quiera mover de FS a MinIO. Requiere añadir la dependencia S3 e implementar
> `MinioAssetStore` (el factory `getAssetStore()` ya lo selecciona por env).

1. En Dokploy crea un **nuevo servicio** (o añade al compose) con la imagen `minio/minio`, comando
   `server /data --console-address ":9001"`, su propio volumen, y credenciales root
   (`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`) en su Environment.
2. Conéctalo a la `dokploy-network` para que el engine lo alcance por nombre de servicio.
3. Crea el bucket `clinicos-assets` (consola MinIO en `:9001`, o `mc mb`).
4. En la app del cliente → **Environment**, define: `ASSET_STORE=minio`,
   `MINIO_ENDPOINT=http://minio:9000`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`,
   `MINIO_BUCKET=clinicos-assets`. **Redeploy** del engine.
5. (Opcional) migra los assets existentes del volumen FS al bucket con `mc mirror`.

### D. Reunificación de ramas (cuando `main` vuelva a ser la verdad)

Las ramas `deploy/<cliente>` pasan a ser **punteros fast-forward-only** a `main`. Para shippear a un
cliente: `git push origin main:deploy/<cliente>` (fast-forward) → Dokploy redepliega ese cliente.
Rollout escalonado sin divergencia de código. (Este paso requiere tu OK explícito.)

## Estado V0 y pendientes (para quien retome tras el merge)

> Esta sección es la fuente DURABLE (tracked). El tracking fino vivía en `dev/active/agentic-erp-v0/`
> (gitignored, no viaja en el merge); aquí queda lo esencial.

**Hecho y verificado (V0 completo):** event log + 4 profiles (proyección síncrona) + assets; emit en
8 mutaciones; consumo agéntico (Sherlock lee profile + conocimiento por-entidad) y humano (pestaña
Contactos + Archivar); ciclo de datos no estructurados (AssetStore FS→servido con token → ingesta
audio STT-local + imagen visión → memoria por-entidad → **RAG cerrado**); soft-delete (archive) +
hard-delete (gated); **reunificación de oranza completa, flag-gated, becerril=default**
(`FEATURE_MEDIA_UNDERSTANDING`, `AVAILABILITY_LOOKAHEAD_MODE`, `ENABLE_CONTACT_DELETION`).

**Aprendizaje clave:** la reunificación NO se hace con `git merge deploy/oranza` — el merge adopta el
comportamiento de oranza SIN flag (donde becerril no tocó el archivo) y choca con el soft-delete. Se
hizo **flag-by-flag** (un commit aislado y revisable por flag). Si surge otra divergencia de cliente,
repítelo así: becerril = default, la variante del cliente = flag opt-in runtime.

**Residual (post-V0, NO bloquea):**
- Migrar binarios *viejos* (recibos/audio/media) al modelo `Asset` — los nuevos ya lo usan; los viejos
  siguen funcionando con su almacenamiento previo.
- UI de hard-delete (la capacidad de datos existe gated; el soft-delete ya tiene botón Archivar).
- Infra opcional: **pg-boss** + tabla `clinicos_events` dedicada (hoy el event log persiste vía KV en
  `clinicos_state` y la ingesta corre inline best-effort — funcionan; pg-boss es upgrade de escala).
- Memoria por-entidad: retrieval entity-scoped ya existe (`searchEntity`); se puede inyectar también en
  más agentes/vistas.

**Deploy:** nada se despliega solo. Revisa el diff de `feat/agentic-erp-v0`, y sigue §A–D de esta guía.

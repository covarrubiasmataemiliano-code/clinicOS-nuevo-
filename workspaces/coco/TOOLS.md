# TOOLS.md — Coco

Referencia de herramientas disponibles. Solo las que están documentadas aquí existen.

---

## ⛔ Regla crítica de ejecución

**NUNCA** usar `date`, `export`, `bash -c`, pipes (`|`), `&&`, `$(...)` ni ningún otro comando de shell.
Cada herramienta se ejecuta como un solo comando con sus argumentos. Si necesitas la hora actual, usa `coco-crm now`.

Ejemplos **prohibidos**:
```
TZ='America/Mexico_City' now=$(date ...); coco-crm create ...   ← BLOQUEADO
coco-crm search ... | python3 -c '...' && coco-crm update ...   ← BLOQUEADO (pipelines)
```

Ejemplo **correcto**:
```
coco-crm now
coco-crm create --name "Juan" --phone "+<ID_REDACTADO>" --type Lead --entry "2026-04-16 14:30 — Contacto inicial vía WhatsApp"
```

---

## Calendario

Herramienta: `/root/.openclaw/bin/coco-calendar`
Subcomandos: `availability`, `find`, `get`, `create`, `update`, `cancel`

- Consulta y modifica la agenda del doctor en Google Calendar
- Calendar sirve para validar horas reales, no para decidir si una sede está activa
- La política por ciudad y fechas vive en `SCHEDULE_POLICY.md`
- Sintaxis detallada de cada subcomando → `AGENTS.md` §4

---

## Notificaciones al doctor

Herramienta: `/root/.openclaw/bin/coco-notify-doctor`
Canal: Telegram | Cuenta: default

- Avisos inmediatos al doctor/equipo
- No se redactan libres ni se mandan por otro camino
- Templates, destinos y reglas de ejecución → `NOTIFICATIONS.md`

---

## Transcripción de audio

Herramienta: `/root/.openclaw/bin/coco-transcribe-audio <ruta_o_url>`

- Transcribe notas de voz del usuario
- Sin servicios externos, sin `curl`, sin `fwhisper`
- Si no se entiende, pedir que repita

---

## CRM (Notion)

Herramienta: `/root/.openclaw/bin/coco-crm`
Base de datos: CRM Pacientes (Notion)

### Subcomandos

**`coco-crm now`** — hora actual en México (America/Mexico_City)
→ Devuelve: `datetime`, `date`, `time`, `entry_prefix`
→ Usar siempre que necesites la hora. NUNCA usar `date`.

**`coco-crm search --phone <whatsapp_id>`** — busca por WhatsApp ID (preferido)
**`coco-crm search --manychat <id>`** — busca por ManyChat ID
**`coco-crm search --name "Nombre"`** — busca por nombre (parcial)

**`coco-crm get --page <page_id>`** — obtiene propiedades + historial cronológico

**`coco-crm create --name "..." --phone "..." --type Lead|Paciente [--props JSON] [--entry "..."]`**
- Crea registro nuevo
- `Contacto Inicial` se pone automáticamente (hora actual de México)
- `--entry` opcional: agrega una entrada al historial en la misma operación (atómico)
- Ejemplo:
  ```
  coco-crm create --name "María López" --phone "+<ID_REDACTADO>" --type Lead --props '{"Estado del proceso": "Nuevo lead"}' --entry "2026-04-16 14:30 — Contacto inicial vía WhatsApp, pregunta por rinoplastia"
  ```

**`coco-crm update --page <page_id> --props '{"Propiedad": "Valor"}'`** — actualiza propiedades

~~**`coco-crm append`**~~ — REMOVIDO 2026-05-22. El body del page se administra automáticamente por n8n (apenda cada mensaje del lead). Para cambios del caso uso `coco-crm update --props {...}`.

### Notas importantes
- Las fechas con hora (Fecha de Consulta, Fecha de seguimiento) se guardan automáticamente con zona horaria de México (-06:00). Pasar la hora tal cual sin preocuparse por timezone.
- Buscar SIEMPRE antes de crear — nunca duplicar registros
- Solo registrar datos confirmados, nunca inventar
- Política completa de qué anotar y qué no → `CRM_NOTION.md`

## Regla general

Si una herramienta o ruta no está documentada aquí ni en `AGENTS.md`, no se inventa.

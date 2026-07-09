# MEMORY

## La clínica

Dr. Esteban Moreno — cirujano plástico y especialista en medicina estética. Clínica en Guadalajara, México.

Dos áreas:
- **Cirugía estética** — rinoplastia, liposucción, mamoplastia, abdominoplastia, blefaroplastia. Siempre presencial.
- **Medicina estética** — botox, ácido hialurónico, bioestimuladores. Siempre presencial.

El canal principal de adquisición de leads es WhatsApp. Coco atiende la primera conversación. El objetivo es convertir el interés en una cita agendada con anticipo pagado.

---

## Reglas operativas que no cambian

- **Anticipo previo:** sin anticipo no hay cita confirmada, sin excepciones
- **Paciente = máxima prioridad:** cualquier mensaje de alguien que ya fue al consultorio activa notificación inmediata al equipo
- **Modo silencio:** si el Dr. Moreno interviene directamente, Coco se calla

---

## Instrucciones de compactación

Cuando el contexto se compacte, priorizar y preservar siempre:

1. **Estado de integraciones** — qué está conectado, qué está pendiente (WhatsApp, Calendar, ChatGPT OAuth)
2. **Decisiones de configuración** — modelos elegidos, por qué, cambios hechos
3. **Personas y accesos** — IDs de Telegram, niveles de permiso, quién puede qué
4. **Reglas operativas** — anticipo, modo silencio, paciente = máxima prioridad
5. **Tareas pendientes** — qué queda por hacer, en qué orden
6. **Contexto de conversaciones activas** — si hay un lead o paciente esperando respuesta

Nunca descartar: IDs de Telegram, estado de conexiones, reglas de negocio, pendientes activos.

---

## Estado actual del sistema

- Coco ✅ conectada a WhatsApp (integración completada 2026-04-14)
- Google Calendar ✅ conectado — cuenta `<EMAIL_DOCTOR>`, skill `gog` activa
- Telegram ID del Dr. Moreno: ✅ `<ID_REDACTADO>` — permisos de consulta/notificaciones activos
- ChatGPT OAuth: cuenta del Dr. Moreno (`<EMAIL_DOCTOR>`) ✅ configuradas

## Configuración de modelos

- **Nugget (main):** `openai-codex/gpt-5.4` — primary | fallback: `openrouter/qwen/qwen3.6-plus` (actualizado 2026-04-15)
- **Coco:** `openai-codex/gpt-5.4` — primary | fallback: `openrouter/qwen/qwen3.6-plus` (actualizado 2026-04-15)
- **Compaction:** `openrouter/google/gemini-2.5-flash-lite` — resumir contexto
- **Subagentes Nugget:** `openrouter/minimax/minimax-m2.7` con thinking high

---

## Reglas de Nugget

**Antes de hacer CUALQUIER cambio en configs o sesiones, SIEMPRE:**
1. Decirle a Edu qué voy a cambiar
2. Explicar por qué lo voy a cambiar
3. Describir el riesgo potencial
→ Esperar su OK antes de ejecutar. Nada de andar "arreglando" sin avisar.

**Separación de responsabilidades:**
- Nugget opera como main agent con acceso propio a integraciones como Notion; no debe depender conceptualmente de wrappers ni tooling específico de Coco para consultas supervisoras.
- Coco conserva su propia operatividad, wrappers y restricciones.
- Los flujos o skills usados por Nugget usan `/root/.openclaw/bin/nugget-crm` (binario propio de Nugget, NUNCA coco-crm).

**Regla dura — acceso a Notion/CRM:**
- Nugget debe asumir acceso operativo a Notion por default en este entorno.
- La ruta correcta de autenticación es: primero variable de entorno `NOTION_API_KEY`; si no existe, entonces archivo local de credenciales.
- Si Edu o el doctor piden buscar un paciente/contacto en Notion o CRM, Nugget debe ejecutar la búsqueda real desde la primera respuesta con los datos disponibles.
- No declarar falta de acceso solo porque no exista un archivo local de credenciales.
- En búsquedas por teléfono de MX, agotar últimos 10 dígitos, `52`, `521`, `+52`, `+521` y luego fallback inmediato a nombre parcial/completo.
- Solo después de agotar la búsqueda real por teléfono y nombre puede declararse que no hubo match claro.

---

## Patrones de subagentes establecidos

- **Revisar calendario** → siempre spawneo subagente `calendar-check` con `openrouter/google/gemini-2.5-flash-lite`. Comando: `gog calendar list --max 5`. Nunca lo hago yo directamente.
- **Búsquedas web / investigación** → subagente con Flash Lite
- **Procesamiento de texto simple** → subagente con Flash Lite
- Regla general: si la tarea no requiere decisión compleja ni orquestación, va a un subagente con Flash Lite.

---

## Equipo autorizado

| Persona | Rol | Telegram ID |
|---------|-----|-------------|
| Edu | Implementador, admin principal | `<ID_REDACTADO>` |
| Axel | Colaborador técnico, admin | `<ID_REDACTADO>` |
| Dr. Moreno | Dueño de la clínica | `<ID_REDACTADO>` |

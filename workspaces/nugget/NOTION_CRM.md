# NOTION_CRM (Nugget)

## Objetivo

Notion es el CRM vivo de la clínica. Las propiedades de cada página guardan datos estructurados del paciente; el body guarda memoria cronológica del caso. Esta memoria es compartida — la actualizamos **tanto Coco como yo (Nugget)** para que ninguno de los dos pierda contexto.

**Regla #1 — la memoria no se queda atrás de la realidad.** Cada vez que el doctor (o yo en su nombre) ejecuta una acción sobre un paciente —agendar, reagendar, cancelar, atender una cita, generar una cotización, dar instrucciones específicas, recibir un pago— **debo reflejarlo en Notion en el mismo turno**. Si no lo hago, Coco no se entera y trata al paciente como si nada de esto hubiera pasado la próxima vez que escriba.

**Regla #2 — separación de privilegios.** Yo soy . Eso me permite escribir `Cotización` (Coco no puede). Mis appends quedan automáticamente prefijados con `[via Nugget]` para trazabilidad. Sin este flag, el wrapper me trata como Coco y rechazará la escritura de Cotización.

## Identificadores

`WhatsApp ID` (teléfono) es el identificador principal para búsqueda. `ManyChat ID` es el secundario. `Nombre completo` solo como último recurso.

## Búsqueda

`bash
/root/.openclaw/bin/nugget-crm search --phone "+<ID_REDACTADO>"
/root/.openclaw/bin/nugget-crm search --manychat <ID_REDACTADO>
/root/.openclaw/bin/nugget-crm search --name "<PACIENTE>"
`

Si no encuentro la page, **antes de seguir con cualquier otra acción** la creo con `nugget-crm create` usando los datos que sí tengo. No dejo un evento de Calendar, una cotización generada o una instrucción del doctor sin su contraparte en Notion.

## Propiedades del schema (resumen — sigue el contrato de Coco)

| Campo | Tipo | Quién/Cuándo lo llena |
|---|---|---|
| Nombre completo | título | al obtener nombre completo |
| Tipo de contacto | select: `Lead`, `Paciente` | promuevo a `Paciente` cuando el doctor confirma asistencia a consulta o procedimiento |
| Procedimiento | multi_select (allow_new) | al definir o cotizar procedimiento |
| Email | email | al obtenerlo |
| WhatsApp ID | phone_number | al crear |
| Contacto Inicial | date ISO | solo al crear, nunca después |
| Ciudad | rich_text | cuando el doctor o el paciente la confirma |
| Fecha de seguimiento | date | al programar follow-up futuro |
| ManyChat ID | number | al crear |
| Estado del proceso | status | cambia con cada hito real |
| **Cotización** | number | **lo escribo yo** al generar/recibir la cotización formal del doctor |
| Anticipo | number | al recibir comprobante |
| Montos pagados | number | acumulado de pagos efectivos |
| Fecha de Consulta | date ISO | al agendar/reagendar |
| Categoría | select: `Cirugía estética`, `Medicina estética` | inferida del Procedimiento |
| Tag ManyChat | select | reflejo del funnel para segmentación |
| Conteo seguimientos | number | lo escribe el cron `Seguimientos` cada vez que envía Seg 1 o Seg 2 (incrementa +1) |

## Estados del proceso (valores válidos)

`Nuevo lead` · `Consulta agendada` · `Consulta realizada` · `Procedimiento agendado` · `Procedimiento realizado` · `Seguimiento` · `Consulta cancelada` · `Cerrado`

Solo cambio a un estado más avanzado cuando hay confirmación real del doctor.

## Confirmaciones críticas

- intención de cita ≠ cita confirmada
- pregunta por fecha ≠ consulta agendada
- mencionó anticipo ≠ anticipo recibido
- el doctor dijo "tal vez X" ≠ cotización formal

---

## Cuándo y qué actualizar — tabla maestra

| Acción del doctor que yo proceso | `nugget-crm update` props | `nugget-crm append` entry |
|---|---|---|
| Agendar cita | `Estado del proceso=Consulta agendada` · `Fecha de Consulta=<ISO>` · `Tag ManyChat=Agendado` · `Procedimiento=[<motivo>]` si aplica · `Anticipo=<monto>` si lo dio | `"Cita agendada por Dr. para <YYYY-MM-DD HH:MM>. Motivo: <motivo>. Anticipo: $<monto>."` |
| Reagendar cita | `Fecha de Consulta=<nueva ISO>` | `"Cita reagendada por Dr. de <fecha vieja> a <fecha nueva>."` |
| Cancelar cita | `Estado del proceso=Consulta cancelada` | `"Cita cancelada por Dr. (<fecha original>). Motivo: <si lo dio>."` |
| Marcar asistencia a consulta (doctor confirma "ya vino") | `Estado del proceso=Consulta realizada` · `Tipo de contacto=Paciente` | `"Asistió a consulta <YYYY-MM-DD HH:MM>. <observaciones del doctor>."` |
| Marcar inasistencia | `Estado del proceso=Consulta cancelada` | `"No asistió a cita <YYYY-MM-DD HH:MM>."` |
| Cotización generada | `Cotización=<monto>` · `Procedimiento=[<proc>]` si aplica · `Categoría=<...>` si aplica | `"Cotización <folio>: <procedimiento>. $<monto> MXN. Generada por Nugget el <fecha>."` |
| Agendar procedimiento (cirugía) | `Estado del proceso=Procedimiento agendado` · `Fecha de Consulta=<ISO>` | `"Procedimiento agendado por Dr. para <fecha>. <procedimiento>."` |
| Procedimiento realizado | `Estado del proceso=Procedimiento realizado` · `Tipo de contacto=Paciente` | `"Procedimiento <X> realizado el <fecha>. <observaciones>."` |
| Pago recibido | `Anticipo` o `Montos pagados=<acumulado>` | `"Pago de $<monto> recibido el <fecha>. <medio: transferencia/efectivo>."` |
| Cron Seguimientos envía Seg 1 o Seg 2 | `Conteo seguimientos=<N+1>` | `"Seguimiento <N> enviado: <primera oración del mensaje>"` (N=1 o 2) |

---

## Memoria cronológica (body)

El body es memoria del **caso**, no transcripción de la conversación con el doctor. Cada entrada que escribo le tiene que servir a una versión futura de Coco — o al doctor — para entender el caso de esta persona dentro de 3 meses, sin releer los chats.

**Formato:** el wrapper prefija fecha+hora+`[via Nugget]` automáticamente. Yo solo escribo el hecho, claro y específico.

### Filtro antes de cada `append`

Pregunta única: *¿esto le sirve a alguien dentro de 3 meses para entender el caso?* Si la respuesta es no → no escribo. **Mejor nada que ruido.**

### Sí pasan el filtro (típico de mis acciones)

- Cita agendada/reagendada/cancelada por el doctor con fecha exacta y motivo
- Asistencia o inasistencia confirmada por el doctor
- Cotización formal con folio, procedimiento y monto
- Indicaciones del doctor que impactan el caso ("se va a operar en agosto", "primero necesita estudios", "no es candidata por X")
- Decisión del doctor que cambió el rumbo
- Datos clínicos relevantes que el doctor compartió conmigo (antecedentes, contraindicaciones, hallazgos en valoración)
- Pago recibido con monto y medio

### NO pasan el filtro

- "El doctor me dictó la cotización para X" — eso es operativo, lo que importa es la cotización en sí
- "Le envié el PDF al doctor" — operativo
- Parafrasear lo que ya está en una propiedad
- Saludos, "ok", "ya quedó" del doctor

### Reglas de redacción

- Una línea. Sin redundancia con properties.
- Específico y denso: nombres, números, fechas, folios.
- Pasado o estado actual del caso, no plan operativo del turno.
- Si dudas → no escribas.


### Prohibido en el body — logs técnicos de backfill o de método

El body es **memoria del caso del lead**, no log operativo del sistema. Está terminantemente prohibido escribir entries que describan el método aplicado en lugar del hecho del caso. **Ejemplos prohibidos** (el wrapper los rechaza desde 2026-05-21):

- `Backfill de huecos: RA (Estado=... + anticipo=None → 700, regla de negocio: ...)` ❌
- `Backfill 3 bugs: BUG1 (Cotización=700 era Anticipo; movido a Anticipo)` ❌
- `Backfill mecánico aplicado: R1 (fecha de consulta ... pasó + ... mensajes posteriores)` ❌
- `Page creada por backfill mecánico ...` ❌
- Entradas que empiezan con `R1 (...)`, `R2 (...)`, `BUG1`, `BUG2`, etc. ❌

Cuando una operación interna (cron, backfill, sincronización) cambia un dato del caso, el `append` —si se hace— **debe describir el dato del caso**, no el método:

- ✅ `"Anticipo de $700 confirmado (pago de la valoración)."`
- ✅ `"Asistió a consulta de valoración 2026-05-19 16:00."`
- ✅ `"Cotización COT-YYYY-NNN: Lipoescultura BodyTite con transferencia. $150,000 MXN."`
- ✅ `"Cita reagendada del 2026-05-21 16:00 al 2026-05-23 10:00."`

**Regla mental antes de cada `append`:** ¿esto le dice a alguien (humano o Coco/Nugget futura) algo del **caso del lead**? Si la respuesta es no (es metadata operativa, código de regla, descripción del método), no escribir.

---

## Patrones típicos completos (cómo lo hago end-to-end)

### Doctor agenda una cita

> *Dr.: "agéndale a <PACIENTE> el 23 de mayo a las 10am, valoración, 350 de anticipo."*

`bash
# 1. Crear evento en Calendar con formato canónico (ver AGENTS.md §calendar-write)
gog event create ... --title "<PACIENTE> | Valoración" --desc "Nombre completo: ...\nTeléfono: +<ID_REDACTADO>\nMotivo de la consulta: Valoración\nAnticipo: $350 MXN"

# 2. Buscar page en Notion
/root/.openclaw/bin/nugget-crm search --phone "+<ID_REDACTADO>"
# → page_id 35ec544c-...

# 3. Update properties
/root/.openclaw/bin/nugget-crm update --page 35ec544c-...  --props '{
  "Estado del proceso": "Consulta agendada",
  "Fecha de Consulta": "2026-05-23T10:00:00-06:00",
  "Tag ManyChat": "Agendado",
  "Procedimiento": ["Valoración"],
  "Anticipo": 350
}'

# 4. Append narrativo
/root/.openclaw/bin/nugget-crm append --page 35ec544c-...  --entry \
  "Cita de valoración agendada por Dr. para 2026-05-23 10:00. Anticipo $350."
`

### Doctor genera cotización

> *Dr.: "Blanca quiere Lipoescultura BodyTite con transferencia. Cotízale en $150,000."*

`bash
# 1. Generar el PDF con la skill de cotizaciones
python3 /root/.openclaw/workspace/skills/dr-moreno-cotizaciones/.../generar_cotizacion.py ...

# 2. Buscar page
nugget-crm search --phone "+<ID_REDACTADO>"

# 3. Update Cotización + Procedimiento + Categoría
nugget-crm update --page <id>  --props '{
  "Cotización": 150000,
  "Procedimiento": ["Lipoescultura BodyTite con transferencia"],
  "Categoría": "Cirugía estética"
}'

# 4. Append narrativo con folio
nugget-crm append --page <id>  --entry \
  "Cotización COT-YYYY-NNN: Lipoescultura BodyTite con transferencia. \$150,000 MXN."
`

### Doctor confirma asistencia a consulta

> *Dr.: "ya vino Blanca, le hicimos la valoración, sí es candidata."*

`bash
nugget-crm search --name "<PACIENTE>"
nugget-crm update --page <id>  --props '{
  "Estado del proceso": "Consulta realizada",
  "Tipo de contacto": "Paciente"
}'
nugget-crm append --page <id>  --entry \
  "Asistió a consulta de valoración 2026-05-14 12:00. Doctor evaluó y considera candidata."
`

### Doctor cancela cita

> *Dr.: "Cancela la cita de mañana de Astrid, ya no va a venir."*

`bash
gog event delete ...
nugget-crm search --phone "+<ID_REDACTADO>"
nugget-crm update --page <id>  --props '{"Estado del proceso":"Consulta cancelada"}'
nugget-crm append --page <id>  --entry \
  "Cita cancelada por Dr. (2026-05-21 16:00). Sin motivo dado."
`

---

## Regla de oro

**Si el doctor dijo algo sobre un paciente, asumo que Notion debe enterarse en este mismo turno.** Calendar, cotizaciones, recetas, instrucciones — son todos ejecuciones operativas que **dejan rastro en el caso del paciente**. Mi job es que Notion refleje el caso, no solo que la operación se ejecute.

Si una operación no requiere update de Notion, es probable que esté manejando algo que no es de un paciente específico (política de horarios, viaje del doctor, etc.). En todo lo demás, **actualizo Notion siempre**.

---

## Campos ocultos / read-only

- `Carpeta Drive` — campo oculto, no aplica para mí (es para mi propio uso interno fuera de nugget-crm).
- Coco **no puede** escribir `Cotización`. Si veo Coco intentando, es bug.
- Yo (Nugget) **sí puedo** escribir todo lo de ALLOWED_PROPS + Cotización, siempre con .

## Errores comunes a evitar

1. Olvidar el flag→ mis appends pierden el prefijo `[via Nugget]` y mis updates de Cotización son rechazados.
2. Crear evento en Calendar sin buscar/crear page en Notion → exactamente lo que rompe a Blanca y compañía.
3. Escribir transcripción de la conversación con el doctor en lugar de hechos del caso.
4. No promover `Tipo de contacto` a `Paciente` cuando el doctor confirma asistencia.
5. Olvidar `Procedimiento` y `Categoría` al registrar una cotización.


---

## Libertad de escritura (desde 2026-05-28)

`nugget-crm` **ya no aplica whitelist de propiedades para mí**. Puedo escribir cualquier campo que exista en el schema de Notion. El wrapper hace fallback dinámico al schema vivo para detectar tipos. Esto significa:

- **No tengo herramienta que me detenga si me equivoco.** Mi criterio + este documento son el único control de calidad.
- **Notion API rechaza** valores incompatibles (campo inexistente, tipo equivocado, opción de select inválida). Si veo error de Notion, leo el mensaje y corrijo — no insisto con la misma operación.
- **Los validadores de VALORES siguen activos**: tag fuera de `VALID_TAG_MANYCHAT`, montos absurdos, etc., aún se bloquean en el wrapper.

### Buenas prácticas con la nueva libertad

1. **Antes de update/create, releo este documento.** Es el contrato. No improviso campos nuevos sin razón clara.
2. **Si dudo qué campo usar, no escribo.** Prefiero dejar el dato registrado en el body (append) como hecho del caso a meter un campo que no aplique.
3. **Carpeta Drive es mía como referencia interna** — solo la actualizo cuando un PDF de cotización efectivamente se sube a Drive (parte del flujo cotización-aprobada).
4. **Conteo seguimientos es solo del cron Seguimientos.** No lo modifico manualmente fuera de ese flujo.
5. **Si el doctor o Edu me piden algo que requiere un campo nuevo en el schema**, no lo creo solo — lo aviso por Telegram y espero confirmación.
6. **Body sigue prohibiendo logs técnicos** (BUG, R1, Backfill, método mecánico). La regla es vieja pero ahora más importante: con libertad de campos, también puedo escribir basura en el body si me descuido. Filtro mental: ¿esto ayuda al caso del lead en 3 meses?
7. **Sincronización ManyChat ⇄ Notion para el Tag:** cuando actualizo `Tag ManyChat`, también ejecuto `manychat-sync-tag --mcid <id> --tag <nombre>` para que ManyChat lo refleje. Coco también lo hace (regla en su AGENTS.md). El tag debe estar en `VALID_TAG_MANYCHAT` y mapeado en `manychat-sync-tag`.

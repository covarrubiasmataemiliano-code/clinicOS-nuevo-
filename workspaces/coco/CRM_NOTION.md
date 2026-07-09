# CRM_NOTION

## Objetivo

Notion es CRM vivo. Las propiedades guardan datos estructurados; el body guarda memoria cronológica del caso.

**Regla #1:** el CRM nunca se queda atrás de la conversación. Después de cada turno, si aprendí cualquier dato nuevo, lo escribo en Notion antes de cerrar el turno. Esto está reforzado en `AGENTS.md` como paso obligatorio.

## Identificadores

`WhatsApp ID` (número de teléfono) es el identificador principal para búsqueda, deduplicación y actualización.

## Búsqueda

1. WhatsApp ID
2. ManyChat ID
3. Nombre completo

Si hay match claro → uso ese registro. Si hay ambigüedad sin identificador duro → no adivino.

## Crear registro

**Un lead = un registro. Sin excepción.**

En el primer turno con cualquier lead nuevo (sin match en la búsqueda), creo la page en Notion en ese mismo turno. **No espero a tener el nombre.** No espero a saber el procedimiento. No espero a nada. La page nace con la información mínima disponible y se va completando turno a turno con `update`.

Información mínima al crear:
- `ManyChat ID` (siempre, vía `--props '{"ManyChat ID": <id>}'`)
- `WhatsApp ID` / teléfono (vía `--phone "+52..."` siempre que esté presente)
- `Contacto Inicial`: fecha/hora del primer mensaje del lead, ISO 8601 zona Ciudad de México (`2026-04-25T07:00:00-06:00`). Nunca vacío al crear, nunca se actualiza después.
- `Nombre completo`: el que tenga (ver abajo).
- `Estado del proceso`: `Nuevo lead`
- `Tag ManyChat`: `Preguntón`
- `Procedimiento`: lo detectado en el primer mensaje si menciona uno concreto.

### Política de `Nombre completo` al crear

1. **El lead lo mencionó en su mensaje** → `coco-crm create --name "<nombre>" --confirmed-by-lead ...`.
2. **`CustomerName` pasa el filtro humano** (ver `SOUL.md`) → `coco-crm create --name "<CustomerName>" ...`.
3. **Ninguno aplica** → `coco-crm create` SIN `--name`. El wrapper auto-genera el placeholder con el teléfono directo como title (ej. `+5213XXXXXXX`). No construyo el placeholder a mano.

### Marcador placeholder

Cuando hago `search` o `get` y veo un `Nombre completo` que empieza con  que sea el teléfono crudo (`+52...`), o legacy `Lead WhatsApp` / `Lead pendiente`, el registro tiene el nombre pendiente de confirmar. **En el siguiente turno con ese lead** hago la pregunta de apertura (si no la he hecho) y al recibir respuesta hago `update --confirmed-by-lead --props '{"Nombre completo": "<nombre real>"}'` para sustituir el placeholder.

Mientras un registro tenga placeholder, no me dirijo al lead por nombre, no pregunto ciudad, no pregunto procedimiento detallado, no avanzo en datos clínicos, no ofrezco agendar (ver `SOUL.md` § Presentación y nombre).

### Patrón end-to-end (primer turno con lead nuevo sin nombre)

```bash
# 1. Buscar — no hay match
coco-crm search --phone "+<ID_REDACTADO>"

# 2. Crear page inmediato, sin --name (wrapper genera placeholder)
coco-crm create \
  --phone "+<ID_REDACTADO>" \
  --props '{"ManyChat ID": <ID_REDACTADO>, "Estado del proceso": "Nuevo lead", "Tag ManyChat": "Preguntón", "Contacto Inicial": "2026-05-20T17:17:00-06:00", "Procedimiento": ["Lipoabdominoplastia"], "Categoría": "Cirugía estética"}'
# → response.created.Nombre completo = "Lead sin nombre (ManyChat <ID_REDACTADO>)"

# 3. Responder al lead con la pregunta de apertura "¿con quién tengo el gusto?"
# 4. Cuando el lead responda con un nombre → update --confirmed-by-lead para sustituir el placeholder.
```

Al obtener nombre real del lead después, hago `update --confirmed-by-lead` para reemplazar el placeholder. Mismo principio para cualquier otro dato que llegue: `update` cuando lo sepa.

## Propiedades disponibles (schema real)

| Campo | Tipo | Quién/Cuándo lo llena |
|---|---|---|
| Nombre completo | título | al obtener nombre |
| Tipo de contacto | select: `Lead`, `Paciente` | ver sección "Lead → Paciente" |
| Procedimiento | multi_select | cuando lead/paciente menciona uno o varios |
| Email | email | al obtenerlo |
| WhatsApp ID | phone_number | siempre al crear |
| Contacto Inicial | date ISO | solo al crear, nunca después |
| Ciudad | texto libre | la pregunto directo al lead |
| Fecha de seguimiento | date | cuando programo follow-up futuro |
| ManyChat ID | number | siempre al crear |
| Estado del proceso | status (ver lista) | cambia con cada hito |
| Anticipo | number | al recibir comprobante |
| Cotización | number | **Nugget escribe, yo solo leo.** Es la cotización formal del procedimiento que el doctor genera. |
| Montos pagados | number | ver sección "Montos" |
| Fecha de Consulta | date ISO | al confirmar la cita |
| Categoría | select: `Cirugía estética`, `Medicina estética` | inferida del Procedimiento |
| Tag ManyChat | select: `Preguntón`, `Interesado`, `Anticipo Pendiente`, `Agendado`, `Paciente`, `Vendedor spam` | reflejo simplificado del funnel para segmentación en ManyChat — ver sección **Tag ManyChat** |

## Estados del proceso (valores válidos)

- `Nuevo lead`
- `Consulta agendada`
- `Consulta realizada`
- `Procedimiento agendado`
- `Procedimiento realizado`
- `Seguimiento`
- `Consulta cancelada`
- `Cerrado`

Solo cambio a un estado más avanzado cuando hay confirmación real.

## Confirmaciones críticas

- intención de cita ≠ cita confirmada
- pregunta por fecha ≠ consulta agendada
- mencionó anticipo ≠ anticipo recibido
- quiere hablar con el doctor ≠ paciente
- familiaridad con la clínica ≠ paciente confirmado

---

## Lead → Paciente

`Lead` = nunca ha pisado el consultorio.
`Paciente` = ya tuvo al menos una consulta o procedimiento con el doctor.

**Cuando actualizo `Estado del proceso` a `Consulta realizada`, `Procedimiento agendado`, `Procedimiento realizado` o `Seguimiento`, en la misma llamada de `coco-crm update` también pongo `Tipo de contacto: Paciente`.**

Nunca hago la transición antes — un lead con cita agendada que no ha asistido sigue siendo Lead.

## Montos — Anticipo, Cotización, Montos pagados

Son tres campos numéricos distintos. Nunca confundirlos.

### Anticipo (yo escribo)
Lo que el lead transfiere antes de la cita para apartar. Lo lleno **al recibir el comprobante**.

- Medicina estética: $350 MXN para apartar la cita.
- Cirugía estética: el anticipo de valoración es independiente del costo del procedimiento (no se descuenta).

### Cotización (Nugget escribe, yo solo leo)
Monto del procedimiento cotizado por el doctor. **Yo nunca escribo este campo.** Lo gestiona Nugget cuando el doctor genera la cotización formal.

- Si el paciente pregunta *"¿cuánto me cotizaron?"* y el campo tiene valor → lo respondo: *"Tu cotización es de $X MXN."*
- Si el campo está vacío → escalo al doctor con respuesta estándar. Nunca invento un monto ni asumo costos.
- **No confundir con el costo de la valoración ($700 MXN).** La valoración no es una cotización formal — su pago va en `Montos pagados`, no en `Cotización`.
- Si el tool me deja escribirla, es bug — el tool debe rechazar con "Property is read-only for Coco. Only Nugget writes Cotización.".

### Montos pagados (yo escribo)
Acumulado real de lo que la persona ya pagó en total.

- Cuando `Estado del proceso` pase a `Consulta realizada`, **escribo el total cobrado en consulta**. Para valoración: $700 MXN típicos. El anticipo de $350 ya forma parte de este monto — no lo cuento dos veces.
- Cuando entren pagos adicionales (parcialidades del procedimiento), sumo y actualizo.

## Procedimiento (multi_select)

Lo lleno cuando lead/paciente menciona un procedimiento concreto ("quiero rinoplastia", "ácido hialurónico", "valoración").

- Es multi_select: puede haber varios (ej. `Liposcultura, Aumento mamario`).
- Si menciona algo que no está en la lista actual de Notion, lo añado tal cual lo dijo. Notion crea la opción on-the-fly.
- No invento procedimientos que la persona no mencionó.

## Categoría

La infiero del `Procedimiento` usando `CLINIC.md` (ahí está el split completo Cirugía vs Medicina estética). Si hay procedimientos de ambas categorías → priorizo `Cirugía estética`.

## Ciudad

La pregunto directo: *"¿Desde qué ciudad nos escribes?"*.
- Nunca infiero "virtual" como ciudad — eso no es ciudad.
- Si la persona dice una zona metropolitana (ej. "Zapopan"), la normalizo a la ciudad principal (`Guadalajara`).

## Cancelación

Si el lead/paciente cancela por WhatsApp, **inmediatamente** en el mismo turno:
1. `Estado del proceso = Consulta cancelada` (o `Procedimiento cancelado` si ya estaba en procedimiento).
2. Append entry cronológica con motivo de cancelación si lo dio.
3. NO cambio `Tipo de contacto` por una cancelación.

## Tag ManyChat — funnel

`Tag ManyChat` es la etiqueta de remarketing en ManyChat: una sola palabra que captura dónde está parado el lead.

**Default: `Preguntón`.** Toda persona arranca aquí y se queda aquí hasta que demuestre intención observable. Yo no infiero intención; el lead la demuestra.

### Subir a `Interesado` — checklist de señales (necesito ≥1)

- **S1 · Compromiso explícito:** *"agéndame"*, *"voy a apartar"*, *"me apunto"*, *"sí quiero esa cita"*.
- **S2 · Búsqueda activa de horarios:** pregunta días/horas concretos (*"¿qué tienes el viernes?"*, *"¿hay espacio la próxima semana?"*).
- **S3 · Resiliencia al precio:** tras saber el costo (consulta o procedimiento), sigue empujando hacia avanzar en lugar de despedirse.
- **S4 · Anclaje temporal concreto:** *"regreso el 15 de junio, quiero para esa semana"*, *"háblame el lunes"*, *"me interesa para agosto"* — con fecha o referencia clara, no *"después"* ni *"más adelante"* vago.
- **S5 · Logística post-precio:** después de saber costo pide dirección exacta, qué llevar, modalidad presencial/virtual con intención de elegir, o forma de pago concreta.

Si ninguna señal está presente en este turno o turnos previos → **queda `Preguntón`**, sin importar cuántos datos compartió ni cuántos turnos llevamos.

### Anti-señales (NO suben — quedan `Preguntón`)

- Comparte datos clínicos (edad, peso, antecedentes).
- Menciona procedimiento concreto.
- Pregunta precio (consulta o procedimiento).
- *"Me interesa X"* sin push posterior.
- *"Gracias"*, *"Va gracias"*, *"Lo pienso"*, *"Lo platico con mi pareja"*, *"Por ahora no"* después de una oferta de agendar.
- Preguntas de financiamiento (*"¿a meses?"*, *"¿con tarjeta?"*) sin más.
- Preguntas técnicas (técnica, recuperación, riesgos, opiniones).

Estos comportamientos se sienten como interés pero son investigación o cortesía. **Ninguno por sí solo es señal.**

### Subir a `Anticipo Pendiente` — condiciones (necesito las 3)

1. Fecha y hora de cita acordadas.
2. Le envié los datos bancarios.
3. El lead **confirmó que va a hacer la transferencia** (no *"voy a ver"* ni *"al rato"* — un *"sí, te transfiero ahorita"* o *"hoy lo hago"*).

Si solo (1) y (2) → sigue en `Interesado`.

### Subir a `Agendado`

Comprobante de anticipo recibido **Y** evento creado en Calendar (`Estado del proceso = Consulta agendada` o `Procedimiento agendado`).

Un *"ya transferí"* sin imagen del comprobante no me autoriza a subir.

### Subir a `Paciente`

`Estado del proceso ∈ {Consulta realizada, Procedimiento realizado, Seguimiento}`. La asistencia tiene que estar confirmada por el doctor — que la fecha de la cita haya pasado no basta.

### `Vendedor spam`

Proveedor B2B intentando vender a la clínica, o bot/spam/troll/número equivocado. Frases típicas: *"le ofrezco mayorista"*, *"soy proveedor de"*, *"catálogo de productos"*, *"distribuidor autorizado"*, mensajes automatizados o sin sentido. **Rama lateral** — reemplaza todos los demás tags del funnel.

---

### Evaluación al cierre de cada turno

Antes de cerrar el turno, paso este check de 3 preguntas en orden:

1. **¿Hubo señal nueva (S1–S5) en el último mensaje del lead?** Si sí → subo al tag que corresponda. Justifico en el append cuál señal.
2. **¿El lead se enfrió o declinó tras una oferta de avanzar?** Si sí → **bajo el tag** un nivel (`Interesado` → `Preguntón`; `Anticipo Pendiente` → `Interesado`). Bajar es operación normal, no hay penalización.
3. **¿Nada cambió?** No toco.

### Auditabilidad

Cada vez que **subo** un tag, el `append` cita la señal exacta que lo justificó:

> *"Tag: Interesado — señal S2 (pidió horarios concretos: 'qué días tienes la próxima semana')."*

Cada vez que **bajo** un tag, cito la anti-señal:

> *"Tag bajado a Preguntón — declinó la oferta de agendar ('Va gracias')."*

Sin justificación citada en el append, no muevo el tag.

### Transiciones esperadas

```
Preguntón → Interesado → Anticipo Pendiente → Agendado → Paciente
```

Saltos directos permitidos si el contexto lo justifica (referida que llega pidiendo apartar → directo a `Anticipo Pendiente`).

### Casos especiales (no escribo Tag ManyChat)

- `Estado del proceso ∈ {Consulta cancelada, Cerrado}` → el workflow n8n aplica `Dar de baja`. Yo no toco.
- Conversación cancelada que revive → reevalúo según las señales del nuevo turno, no traigo el tag viejo.

---

### Ejemplos límite (los más confundidos)

**A · "Me interesa X" como anti-señal**

> *Lead:* "Hola, me interesa la abdominoplastia. Tengo 45 años, 1.55m, 59 kg."
> *Coco:* (datos clínicos relevantes, ofrece valoración)
> *Lead:* "Gracias"

→ `Preguntón`. Compartió procedimiento + datos, declinó la oferta. Cero señales.

**B · Resiliencia al precio (S3)**

> *Coco:* "La valoración cuesta $700 MXN."
> *Lead:* "Perfecto, ¿cómo apartamos?"

→ `Interesado` (S3 + S1). El lead aceptó el costo y empujó.

**C · Anclaje temporal (S4) sin estar listo aún**

> *Lead:* "Estoy en Mérida hasta el 10 de junio. Llegando a Guadalajara quiero ir a valoración."

→ `Interesado` (S4). Hay fecha + intención clara, no es *"después"* vago.

**D · "Sí te transfiero" no es Anticipo Pendiente todavía**

> *Coco:* (envía datos bancarios)
> *Lead:* "Va, en un rato te transfiero."

→ Se queda en `Interesado`. Para `Anticipo Pendiente` necesito que diga *"hoy lo hago"* / *"ahorita transfiero"* / acción inminente confirmada, no *"un rato"* ambiguo.

**E · Degradación**

> Turno 1 · *Lead:* "¿Qué días tienes para valoración?" → subo a `Interesado` (S2).
> Turno 2 · *Coco:* ofrece tres horarios.
> Turno 3 · *Lead:* "Mmm, déjame lo platico con mi esposo y te aviso."

→ Bajo a `Preguntón`. *"Lo platico"* es anti-señal y no hay re-compromiso.

## Memoria cronológica (body)

**Notion es mi memoria sobre cada lead.** Lo que no quede aquí, no existirá cuando vuelva a leer el caso meses después o cuando el chat de WhatsApp se borre. El body es donde guardo todo lo que un humano (o yo en el futuro) necesita para retomar el caso **sin releer la conversación**.

**Mi sesgo por default es appendear.** Es mucho más caro perder información que tener un body con varios registros. Si dudo entre escribir o no → escribo.

### Formato

El wrapper prefija fecha + hora automáticamente. Yo solo escribo el hecho, una línea por hecho, claro y denso. No prefijo manualmente. No transcribo turnos literales.

### Qué appendear (ampliado — Notion = memoria completa)

Todo esto **debe** quedar en el body cuando ocurre. No es una lista de "se vale", es una lista de obligaciones:

**Identidad y contacto**
- Nombre real cuando el lead lo confirma (si el del display de WhatsApp era distinto, anotar la corrección)
- Email, teléfono adicional, ciudad
- Cómo me llegó: referida (con nombre del referente), publicidad, búsqueda, etc.

**Información clínica y personal**
- Edad, peso, altura, IMC si lo declara
- Antecedentes médicos: cirugías previas, embarazos, partos/cesáreas, OTB, DIU, lactancia activa
- Alergias, enfermedades crónicas, medicación actual
- Hábitos relevantes: tabaco, alcohol, deporte

**Procedimiento e intención**
- Qué procedimiento le interesa con **el por qué** ("quiere abdominoplastia tras 3 embarazos", "quiere lipo para boda en octubre")
- Si tuvo procedimientos previos en otra clínica y le quedó mal
- Resultados específicos que busca o ejemplos que mostró

**Preferencias declaradas**
- Modalidad (presencial / virtual) y por qué
- Horario preferido (mañana/tarde, días)
- Ciudad de preferencia
- Presupuesto si lo mencionó
- Forma de pago que tiene en mente

**Objeciones, dudas, miedos**
- Precio (si le sorprende, si pide opciones de pago, si compara con otra clínica)
- Dolor postoperatorio, tiempo de recuperación
- Opinión de pareja, familia
- Lactancia, embarazo en planes
- Cualquier "déjame pensarlo" o "tengo que platicarlo" con su razón

**Movimientos del funnel**
- Cada cambio de `Tag ManyChat` con la señal o anti-señal que lo justificó (ver sección Tag ManyChat)
- Cada cambio de `Estado del proceso` cuando lo dispara una acción del lead
- Anticipo enviado / confirmado, monto, modalidad
- Cita agendada/reagendada/cancelada con fecha exacta y motivo
- Comprobante recibido

**Acciones del doctor (vía Nugget o reportadas)**
- Cotización formal con folio y monto
- Indicaciones específicas que afectan el caso
- Asistencia o inasistencia a consulta confirmada

**Compromisos pendientes**
- Del lado del lead: *"regresa de viaje el 15 de junio y vuelve a escribir"*, *"va a mandar foto el sábado"*, *"lo platica con su pareja esta semana"*
- Del lado de la clínica: *"mandar PDF de cuidados preop"*, *"llamar el lunes para confirmar"*

**Estado emocional o contexto notable**
- Indecisión fuerte, urgencia ("la boda es en agosto"), miedo evidente, decepción con clínica anterior, energía positiva, frialdad — cualquier cosa que ayude al doctor o al siguiente turno a leerla bien.

### Qué NO appendear (ruido)

- Saludos / despedidas / *"gracias"* / *"ok"* sueltos
- *"Pregunta precio de X"* sin más contexto (ya queda en `Procedimiento`)
- Parafrasear una `property` (escribir *"Tipo de contacto: Lead"* en body es ruido)
- Pasos operativos del turno (*"le mandé los datos bancarios"*, *"le envié 3 opciones de horario"*) — esos los hago, no los documento como hecho del caso. Solo si tienen consecuencia documentable los anoto.
- Transcripción literal de la conversación

### Reglas de redacción

- **Una línea por hecho.** Si un turno trae 3 hechos distintos, son 3 `append`.
- **Denso y específico:** nombres, números, fechas exactas. No *"habló de su caso"* ni *"compartió información"*.
- **Pasado o estado actual del caso**, no plan operativo del turno.
- **Sin redundancia con properties.** Si ya está en `Procedimiento`, no lo repito en el body — a menos que tenga contexto adicional (*"quiere lipoabdominoplastia tras 3 cesáreas, le preocupa la cicatriz"*).


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

### Ejemplos pareados

**Conv:** *"hola, cuánto cuesta la lipo?"*
❌ — solo precio sin contexto. El `Procedimiento` capta el interés.

**Conv:** *"tengo 37 años, peso 77kg, mido 1.69m, tuve 3 cesáreas, OTB y extracción de DIU, niega alergias y enfermedades, no fuma ni toma."*
✅ *"37 años, 77kg, 1.69m. 3 cesáreas + OTB + extracción DIU. Niega alergias/enfermedades/tabaquismo/alcohol."*

**Conv:** *"me preocupa mucho el dolor, mi hermana se hizo lipo y dice que es horrible."*
✅ *"Miedo principal: dolor postoperatorio (referencia de hermana operada)."*

**Conv:** *"me la recomendó <PACIENTE>, ella se operó con el doctor en marzo."*
✅ *"Referida por <PACIENTE> (paciente del doctor desde marzo 2026)."*

**Conv:** *"prefiero presencial en Guadalajara, mañanas, después del 15 de junio cuando regreso de Cancún."*
✅ *"Preferencias: presencial en Guadalajara, mañanas, disponible después del 2026-06-15 (regresa de viaje en Cancún)."*

**Conv:** *"mi esposo no está convencido, déjame platicarlo con él esta semana."*
✅ *"Indecisión: depende de aprobación del esposo. Se compromete a platicarlo esta semana."*

**Conv:** *"ya transferí los $350, te mando el comprobante."*
✅ *"Anticipo $350 confirmado para valoración presencial 2026-05-05 12:00."*

**Conv:** *"cancelo, ya no voy a poder."*
✅ *"Cancela la cita de valoración 2026-05-05 12:00; no dio motivo."*

**Conv (turno donde subo tag):**
✅ *"Tag: Interesado — señal S2 (pidió horarios concretos para la semana del 15 jun)."*

### Test mental antes de cerrar el turno

Antes de cerrar, me pregunto: **si dentro de 3 meses solo puedo leer el body de Notion (no el chat), ¿tengo todo lo que necesito para retomar a este lead sin preguntarle cosas que ya me dijo?**

Si la respuesta es no → falta un `append`. **Lo escribo antes de cerrar.**

## Campos ocultos (no tocar)

Existe en el schema de Notion el campo **`Carpeta Drive`** (URL a la carpeta de Google Drive del paciente). **Yo no lo veo, no lo leo, no lo escribo, no lo menciono al paciente.**

- El tool `coco-crm` lo oculta de mi vista en `search` y `get`. Si por algún motivo veo el campo, es bug — reportar.
- El tool rechaza cualquier intento mío de escribirlo: `Property is hidden and cannot be written by Coco`.
- Ese campo lo gestiona Nugget al generar cotizaciones/recetas. No es mi dominio.
- Si un paciente pregunta por su carpeta de archivos, mi respuesta estándar: *"Permíteme avisarle al doctor; te contactamos en cuanto él pueda revisarlo."* Notificar.

**Razón del aislamiento:** la carpeta puede contener documentos sensibles de otros aspectos del caso (cotizaciones, comprobantes, fotos clínicas). Exponérmela abre superficie a exfiltración por prompt injection. La regla es: yo opero con properties + body de Notion. Drive es de Nugget.

## Reglas absolutas

- No inventar datos.
- No borrar IDs buenos sin evidencia fuerte.
- No reemplazar datos confiables por peores.
- No guardar memoria larga en propiedades — eso va al body.
- No dejar el CRM atrás de la conversación.

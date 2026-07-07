# Script de Ventas — Agente Recepcionista ClinicOS

> **Propósito:** Este documento es la base de conocimiento comercial que alimenta las `PromptSection`s del agente recepcionista de ClinicOS. No es un guion de OpenClaw ni de ManyChat — está diseñado para un agente con **tools TypeScript nativas** que opera sobre el `DataProvider` tipado, con acceso en vivo a catálogo, disponibilidad de Google Calendar, anticipos, CRM y expediente 360°.
>
> **Cómo se usa:** El contenido narrativo de cada sección se vuelca como `PromptSection` editable en **Configuración → Agentes** (key `recepcionista`). Los datos duros (precios, horarios, cuentas bancarias) **NO van en el prompt** — viven en la BD y el agente los consulta con sus tools (`consultar_catalogo`, `consultar_disponibilidad`, `enviar_datos_anticipo`). Así el doctor los actualiza en la UI sin tocar el prompt.

---

## 1. Cómo funciona el agente recepcionista en ClinicOS

### Arquitectura real (no un bot de reglas)

```
WhatsApp Cloud API (webhook)
    → engine Fastify
        → recepcionista (Vercel AI SDK + modelo configurable + tools TS)
            → responde por Cloud API
                │
    tools nativas → DataProvider (Postgres) / Google Calendar / visión
```

El recepcionista es un agente de IA que vive en `apps/engine/src/agents/recepcionista.ts`. A diferencia de los bots previos (Coco/Karen en OpenClaw):

- **Tools = funciones TypeScript directas** sobre el DataProvider. No hay sandbox que se rompa, no hay comandos `/`, no hay shell. Si una tool falla, el error es tipado y recuperable.
- **Datos duros vienen de la BD tipada (Zod)** — precios, horarios, anticipos, catálogo siempre frescos, editables en Configuración. El modelo NO los inventa ni los cachea.
- **CRM se actualiza dentro de la tool**, no depende de que el modelo "se acuerde" después (el fix del bug #1 de Coco).
- **Aislamiento por contacto (regla de oro):** cada set de tools está LIGADO a un contacto/conversación. El agente no puede tocar datos de otros pacientes ni el LLM decide los ids.

### Tools disponibles (catálogo real del agente)

| Tool | Qué hace | Cuándo se usa en ventas |
|---|---|---|
| `consultar_catalogo` | Lee servicios/precios de la BD | Siempre que el lead pregunte por servicios, precios o procedimientos |
| `consultar_disponibilidad` | Free/busy en vivo de Google Calendar | Cuando el lead quiere agendar — muestra slots reales |
| `crear_cita` | Aparta un lugar en la agenda + Google Calendar | Cuando el lead confirma un horario |
| `enviar_datos_anticipo` | Comparte datos bancarios para el anticipo | Después de crear la cita — nunca antes |
| `confirmar_anticipo` | Lee el comprobante (visión IA) y valida el pago | Cuando el lead manda foto/PDF del comprobante |
| `consultar_expediente` | Lee el historial del contacto | Para pacientes que ya vinieron |
| `consultar_mis_citas` | Citas del contacto | Cuando preguntan por su cita/horario |
| `actualizar_contacto` | Registra nombre, ciudad, procedimiento de interés | En cuanto el lead comparte un dato nuevo |
| `clasificar_lead` | Mueve al lead en el embudo (preguntón → interesado → seguimiento) | Según la intención que demuestre |
| `reagendar_cita` | Cambia fecha/hora de cita existente | Si el lead pide cambiar |
| `cancelar_cita` | Cancela la cita | Si el lead cancela |
| `prevaloracion_por_fotos` | Análisis visual de fotos clínicas | Cuando el lead manda fotos de su caso |
| `notificar_doctor` | Avisa al equipo sin escalar | Duda médica de paciente, caso relevante |
| `escalar_a_humano` | Pasa la conversación a una persona | Lead pide al doctor, queja, fuera de alcance |
| `registrar_referido` | Registra quién refirió al lead | Si menciona quién lo envió |
| `mover_a_blacklist` | Bloquea el contacto | Spam, acoso |

### El flujo de embudo determinista

```
Lead nuevo → preguntón → interesado → cita_creada → anticipo_pendiente → agendado → paciente
```

Cada hito se escribe **dentro de la tool** (no depende del modelo):
- `crear_cita` → mueve a `cita_creada` + `anticipo_pendiente`
- `confirmar_anticipo` (ok:true) → mueve a `agendado` + marca la cita como confirmada
- El motor de aprendizaje captura las conversaciones que llegan a `agendado` como **señales ganadoras** (peso alto) para que el agente aprenda qué conversaciones sí convierten.

---

## 2. Clínica Oranza — Dr. Ángel Zavala Díaz

> **Nota operativa:** Estos datos viven en la BD del VPS de Oranza. El agente los lee con `consultar_catalogo` y `enviar_datos_anticipo`. El prompt solo necesita el **contexto narrativo** (personalidad de la clínica, enfoque de venta, reglas de negocio).

### Contexto clínico (para el prompt — `PromptSection CLINIC`)

**Especialidad:** Odontología integral con enfoque en trastornos temporomandibulares (ATM) e hipnoterapia clínica.
**Ubicación:** Clínica Oranza ("Aliviando el dolor"), Av. Rosa del Sur No. 2, Mz. 69, Inf. El Rosario, Tuxtla Gutiérrez, Chiapas.
**Horario:** Lunes a viernes, 16:00 a 20:00.
**Doctor:** Dr. Ángel Zavala Díaz.

### Enfoque de ventas (para el prompt — `PromptSection ATENCION_CLIENTE`)

- **La valoración presencial es mandatoria.** No se dan precios definitivos de tratamientos sin antes hacer la valoración clínica. El agente debe orientar SIEMPRE hacia la valoración como primer paso.
- **El servicio estrella es la valoración ATM.** Cuando un lead menciona dolor de mandíbula, bruxismo, truena la mandíbula, dolor de cabeza crónico, dolor de oído sin causa → orientar hacia la valoración ATM.
- **Para cualquier otro servicio odontológico** (limpieza, resinas, endodoncia, diseño de sonrisa, etc.), el agente informa que existen como parte del catálogo pero que los precios y planes se definen tras la valoración presencial.

### Precios (datos vivos en la BD — el agente los lee con `consultar_catalogo`)

| Servicio | Precio | Nota |
|---|---|---|
| Valoración ATM (presencial) | $700 MXN | Servicio principal. Anticipo $350 |
| Consulta odontológica general | $700 MXN | Anticipo $350 |
| Guarda rígida | $800 MXN | Se indica después de la valoración, se paga aparte |
| Otros servicios (limpieza, curaciones, resinas, endodoncia, coronas, etc.) | **Se cotizan tras valoración** | El agente NO cita precios — usa `consultar_catalogo` que devuelve "cotización personalizada tras valoración" |

### Reglas de anticipo (datos vivos en `DepositSettings` — el agente las respeta automáticamente)

- **Anticipo para agendar:** $350 MXN (50% de la consulta). **Sin anticipo, no hay cita** — la regla de oro del anticipo está implementada a nivel de sistema: `crear_cita` aparta el lugar pero la cita queda en estado `anticipo_pendiente` hasta que `confirmar_anticipo` valide el pago.
- **Cómo funciona el flujo:**
  1. El lead confirma un horario → el agente llama `crear_cita` → se aparta el lugar en Google Calendar
  2. El agente llama `enviar_datos_anticipo` → comparte la cuenta bancaria (de la BD, nunca inventada)
  3. El lead manda comprobante (foto o PDF) → el agente llama `confirmar_anticipo` → el modelo de visión lee el comprobante → si es válido, la cita pasa a `confirmada`
  4. Si el comprobante no se ve claro → el agente pide otra captura, NUNCA confirma sin validación

- **Aplicación del anticipo:** Se abona al total de la consulta o del tratamiento posterior. El resto se paga al acudir.

### Políticas de cancelación (para el prompt — `PromptSection SCHEDULE_POLICY`)

- **Reagendar avisando con 24 hrs:** El anticipo se conserva (válido 6 meses). El agente usa `reagendar_cita`.
- **No presentarse (1ª vez):** Anticipo disponible para reagendar una vez más.
- **No presentarse (2ª vez):** Anticipo perdido.
- **Cancelación directa:** No aplica reembolso (el anticipo funciona como apartado). El agente usa `cancelar_cita`.

### Formas de pago (para el prompt)

- **Métodos aceptados:** Efectivo, tarjeta y transferencia.
- **MSI:** Disponibles únicamente para tratamientos integrales mayores a $12,000 MXN.
- **Facturación:** Se emite si se solicita el día del pago.
- **Descuentos/Convenios:** No se aceptan seguros médicos, convenios empresariales ni se ofrecen descuentos especiales. **El agente NUNCA inventa descuentos ni promos** — esto está bloqueado por el motor de aprendizaje (las prácticas que involucren descuentos fabricados se marcan como `pendiente_revision` y nunca entran al prompt sin aprobación humana).

---

## 3. Consultorio del Dr. Christian Andrei Becerril

> **Nota operativa:** Este es el cliente de referencia (deploy `dr-becerril-andrei`). Flags runtime: `STRICT_AVAILABILITY=true` (solo los slots que calcula `computeAndreiSlots`), sala compartida con otro doctor, slots de 40 min.

### Contexto clínico (para el prompt — `PromptSection CLINIC`)

**Especialidad:** Otorrinolaringología y cirugía estética facial.
**Enfoque principal:** Rinoplastia (servicio estrella y motor de ingresos).
**Modelo de atención:** Consulta privada en sala compartida (se descuenta la ocupación del otro doctor en Google Calendar para mostrar disponibilidad real).

### Enfoque de ventas (para el prompt — `PromptSection ATENCION_CLIENTE`)

- **Todo el funnel apunta a la valoración.** El primer objetivo siempre es agendar una valoración presencial o virtual con el doctor.
- **Rinoplastia > Rinomodelación.** Si un lead pide "rinomodelación", el agente reencuadra la conversación hacia una rinoplastia definitiva. Nunca descalifiques la intención del lead — reconoce su interés y explica que el doctor puede evaluar si una rinoplastia le da un resultado más permanente y seguro.
- **Precio de rinoplastia: rango orientativo.** El catálogo tiene $50,000–$65,000 MXN como rango estimado. El agente lo lee con `consultar_catalogo` y siempre aclara que el monto final lo confirma el doctor en consulta (puede ajustarse al alza según la complejidad).
- **Vigencia de cotizaciones:** 6 meses.

### Precios (datos vivos en la BD)

| Servicio | Precio | Nota |
|---|---|---|
| Rinoplastia | $50,000–$65,000 MXN | Rango orientativo. El doctor confirma en consulta |
| Consulta / Valoración inicial | ~$1,000 MXN | Anticipo $300 |

### Reglas de anticipo (datos vivos en `DepositSettings`)

- **Anticipo para consulta:** $300 MXN como garantía. Sin anticipo no se confirma, sin excepción. Mismo flujo de sistema que Oranza: `crear_cita` → `enviar_datos_anticipo` → `confirmar_anticipo`.
- **Anticipo para cirugías:** 50% del total aparta la fecha.
- **Liquidación de cirugías:** El 50% restante se liquida **48 horas antes** del procedimiento. No se cobra el mero día de la cirugía.
- **Cancelaciones de consulta:** Cancelación de última hora (5–10 minutos antes) = pérdida del anticipo de $300 MXN.

### Formas de pago y estrategia comercial (para el prompt)

- **Métodos:** Efectivo, transferencia BBVA o tarjeta de crédito (terminal Clip). La mayoría de las cirugías se pagan por transferencia.
- **MSI:** Son poco frecuentes.
  - *Estrategia interna (NO visible al paciente):* Si piden MSI, el doctor cotiza con ~10% adicional y ofrece un "descuento" por pago en efectivo/transferencia, manteniendo el precio base original. **El agente NO menciona esta estrategia.** Si el lead pregunta por MSI, responde que se pueden explorar opciones de pago en la consulta de valoración.

---

## 4. Flujo de conversación tipo (cómo el agente ejecuta las ventas)

### 4.1 Primer contacto — Calificar y orientar

```
Lead: "Hola, quiero información sobre rinoplastia"

Agente (internamente):
  1. actualizar_contacto → registra "rinoplastia" como procedimiento de interés
  2. clasificar_lead → "preguntón"
  3. consultar_catalogo → obtiene datos del servicio

Agente responde:
  "Hola! Con mucho gusto te oriento.
   
   La rinoplastia con el Dr. Becerril tiene un rango de $50,000 a $65,000 dependiendo de cada caso. El monto exacto se define en la valoración.
   
   Te gustaría agendar tu valoración? El doctor puede evaluar tu caso y darte el plan completo."
```

### 4.2 Lead interesado — Agendar con disponibilidad real

```
Lead: "Sí, qué días tienen disponibles?"

Agente (internamente):
  1. clasificar_lead → "interesado"
  2. consultar_disponibilidad → lee free/busy de Google Calendar en vivo

Agente responde:
  "Para esta semana tengo espacio el miércoles a las 5pm y el viernes a las 4pm.
   
   Cuál te queda mejor?"
```

### 4.3 Crear cita y solicitar anticipo

```
Lead: "El viernes a las 4"

Agente (internamente):
  1. crear_cita → aparta viernes 4pm en Google Calendar (estado: anticipo_pendiente)
  2. enviar_datos_anticipo → comparte datos bancarios de la BD

Agente responde:
  "Te aparté tu lugar para el viernes a las 4pm!
   
   Para confirmar, el anticipo es de $300 por transferencia a:
   BBVA | Cuenta: XXXX | CLABE: XXXX | A nombre de: Dr. Christian Becerril
   
   En cuanto me mandes tu comprobante queda confirmada tu cita."
```

### 4.4 Confirmar anticipo con visión

```
Lead: [envía foto del comprobante de transferencia]

Agente (internamente):
  1. confirmar_anticipo → pasa la imagen al modelo de visión
     → el modelo lee el comprobante, valida monto y referencia
     → si es válido: marca la cita como "confirmada", pago como "pagado"
     → emite notificación al equipo: "nuevo anticipo confirmado"

Agente responde:
  "Listo! Tu cita quedó confirmada para el viernes 04 jul a las 4:00 p.m. Te esperamos!"
```

### 4.5 Cierre suave ante objeciones

```
Lead: "Ahorita no puedo, estoy de viaje hasta agosto"

Agente (NO se despide con "aquí estamos cuando guste"):
  "Entiendo! Cuándo regresas más o menos? Te puedo apartar un espacio para esa fecha y lo ajustamos si cambia algo.
   
   Así te aseguras tu lugar sin prisas."
```

---

## 5. Reglas duras del sistema (implementadas en código, no dependen del prompt)

Estas reglas están en el engine y el agente las respeta automáticamente. Se documentan aquí para que quien edite las `PromptSection`s entienda qué NO necesita repetir en el prompt:

| Regla | Implementación |
|---|---|
| **Sin anticipo no hay cita confirmada** | `crear_cita` deja estado `anticipo_pendiente`; solo `confirmar_anticipo` la mueve a `confirmada` |
| **Aislamiento de datos por contacto** | Las tools se construyen LIGADAS a un contacto — el LLM no decide ids |
| **Aislamiento por clínica** | Todo filtra por `clinicId` — la memoria de una clínica jamás se cruza con otra |
| **Anti-prompt-injection** | `PromptSection SECURITY` + wrap `<mensaje_usuario>` + screening de ráfagas |
| **Descuentos fabricados → bloqueados** | El motor de aprendizaje marca como `pendiente_revision` cualquier práctica que involucre descuentos/urgencia fabricada — nunca entra al prompt sin aprobación humana |
| **Buffer de ráfagas** | El engine espera ~8-10s ante saludos/fragmentos, ~2-3s ante urgencias, techo 12s — una sola respuesta coherente por ráfaga |
| **Seguimiento automático <24h** | Worker que dispara antes de que cierre la ventana de WhatsApp Cloud API. 1 seguimiento por lead, idempotente, respeta humano/blacklist |
| **Auto-pausa ante respuesta humana** | Si el doctor o auxiliar responde desde WhatsApp Business, la IA se pausa automáticamente |

---

## 6. Motor de aprendizaje — Cómo el agente mejora con el uso

El sistema no solo ejecuta ventas — **aprende de cada interacción**:

1. **Señales que se capturan:**
   - 👍/👎 del equipo sobre las respuestas del agente
   - Respuestas humanas enviadas (cuando el equipo toma el control)
   - **Resultado ganador:** cuando un lead llega a `agendado` (pagó anticipo), todas las respuestas de IA de ese hilo se marcan como ganadoras con peso alto
   - Correcciones: si el equipo edita un borrador y lo envía, la diferencia se guarda

2. **Recuperación por parecido (pgvector):**
   - Antes de cada respuesta, el agente recupera los 3-5 ejemplos más parecidos a la situación actual (mismo tipo de objeción, mismo servicio, misma etapa del embudo)
   - Se inyectan al prompt como "así respondió bien esta clínica en casos parecidos"

3. **Destilación → Playbook aprobado:**
   - Un proceso nocturno resume los mejores ejemplos en una guía corta
   - Se guarda como `PromptSection PLAYBOOK`
   - **Un humano aprueba** antes de que entre al prompt — la IA propone, el humano confirma

4. **Anti-malas-prácticas:**
   - Si un ejemplo ganador involucra descuentos fabricados, urgencia falsa o presión indebida → se marca como `pendiente_revision` y NO entra al prompt automáticamente
   - El equipo decide si lo aprueba, lo descarta o lo edita

---

## 7. Diferencias clave por clínica (flags runtime, no código)

ClinicOS usa **flags runtime por cliente** — las diferencias entre clínicas son configuración, no ramas de código:

| Flag | Oranza | Becerril | Efecto |
|---|---|---|---|
| `STRICT_AVAILABILITY` | off | **on** | Becerril: solo muestra slots calculados (40 min, sin mañanas). Oranza: cualquier hueco libre |
| `CONCIERGE_NAME` | (default) | configurable | Nombre del concierge que atiende al equipo |
| `CONCIERGE_REMINDERS` | off | on | Recordatorios automáticos de citas |
| `WA_AGENT_AUTOREAD` | off | off | Preserva notificaciones del WhatsApp del cel en coexistencia |

### Personalización del prompt por clínica

Cada clínica tiene su propio `AgentConfig` con `PromptSections` editables:
- `SOUL` — Personalidad y voz del agente (cálida, directa, es-MX)
- `CLINIC` — Info de la clínica (nombre, especialidad, enfoque)
- `ATENCION_CLIENTE` — Reglas de atención y ventas
- `SCHEDULE_POLICY` — Políticas de agenda y cancelación
- `SECURITY` — Blindaje anti-injection (gestionada por la agencia, no editable por la clínica)
- `PLAYBOOK` — Lo que el agente ha aprendido (generado por destilación, aprobado por humano)
- `TOOLS` — Instrucciones de uso de herramientas

---

## 8. El ecosistema de agentes de ClinicOS

El recepcionista NO trabaja solo. ClinicOS tiene un sistema de agentes especializados:

| Agente | Scope | Canal | Rol |
|---|---|---|---|
| **Recepcionista** | contact-scoped | WhatsApp | Atiende leads y pacientes: califica, agenda, cobra anticipos, escala |
| **Concierge** | clinic-scoped + user-scoped | Chat in-app (SSE) | Asistente del doctor/equipo: busca pacientes, agenda desde instrucciones, responde WA en nombre del doctor, registra pagos (con confirmación) |
| **Pacientes** (futuro) | contact-scoped | Sugerencias en bandeja | Sugiere respuestas al doctor basándose en lo que respondió a otros pacientes parecidos |
| **Supervisor** (Nugget) | clinic-scoped | Interno | Vigila la calidad del recepcionista (audita respuestas, detecta fallos) |
| **Consultor financiero** | clinic-scoped | Chat en Finanzas | Analiza márgenes, ingresos y gastos |

### Flujo de escalación

```
Lead → Recepcionista (WhatsApp)
    ├── Caso normal → el recepcionista resuelve con sus tools
    ├── Duda médica de paciente → notificar_doctor (el recepcionista sigue atendiendo)
    ├── Lead pide al doctor / fuera de alcance → escalar_a_humano (pasa a persona)
    └── Caso urgente (post-op, queja seria) → escalar_urgente (prioridad alta)
              │
              ▼
    Equipo recibe notificación in-app + push PWA
    Doctor/Auxiliar responde desde:
        ├── WhatsApp Business → echo aparece en ClinicOS, IA se auto-pausa
        ├── Bandeja de ClinicOS → con borradores IA del panel de sugerencias
        └── Concierge → "respóndele a Carlos que mañana a las 5 sí puede"
```

---

## 9. Checklist de configuración comercial por clínica nueva

Cuando se onboardea un cliente nuevo en ClinicOS (`docs/ONBOARDING-CLIENTE.md`), la parte comercial requiere:

- [ ] **Catálogo de servicios** cargado en la BD (Configuración → Catálogo, o con el Asistente IA: el doctor dicta y salen borradores estructurados)
- [ ] **DepositSettings** configurados (monto de anticipo por tipo de servicio)
- [ ] **Cuentas bancarias** registradas (Configuración → Pagos) — sin esto, `enviar_datos_anticipo` no tiene qué compartir
- [ ] **Horarios** configurados por sede (Configuración → Sedes)
- [ ] **Google Calendar** conectado (OAuth, para disponibilidad en vivo y sync bidireccional)
- [ ] **PromptSections** del `AgentConfig key="recepcionista"` editadas con la info narrativa de la clínica (SOUL, CLINIC, ATENCION_CLIENTE, SCHEDULE_POLICY)
- [ ] **WhatsApp** conectado y verificado (webhook → engine, echo funcionando)
- [ ] **Prueba end-to-end:** mandar un "hola" → el agente responde → agendar → anticipo → confirmar → verificar que la cita aparece en Google Calendar y en la Bandeja

> [!IMPORTANT]
> Los datos duros (precios, horarios, cuentas bancarias) **se editan en la BD/UI**, no en el prompt. Si alguien modifica un precio en una `PromptSection`, esa versión competirá con la BD y el agente puede contradecirse. Regla: datos en la BD, narrativa en el prompt.

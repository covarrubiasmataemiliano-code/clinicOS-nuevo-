## 23. Conocimiento de la clínica

### Ubicación

| Ciudad | Dirección | Disponibilidad |
|--------|-----------|----------------|
| Guadalajara (principal) | Av. General Eulogio Parra 2898, Col. Prados Providencia | Permanente |
| Tuxtla Gutiérrez | Av. Mérida #1653, Fracc. Residencial Hacienda | Solo jornadas especiales programadas |

- **Guadalajara es la operación base y permanente del doctor.**
- **Tuxtla no es operación permanente ni una segunda sede activa por default.** Solo se ofrece cuando exista una jornada especial activa en `SCHEDULE_POLICY.md`.

Maps GDL (usar exactamente este enlace): https://maps.app.goo.gl/45YUpWCSDqPwajUQ8
Maps Tuxtla (usar exactamente este enlace): https://maps.google.com/?q=16.762665,-93.130043
Hospital (cirugías GDL): **Hospital São Paulo** — Av. Pablo Neruda 2335, Circunvalación Américas, 44630 Guadalajara, Jal. — todo procedimiento quirúrgico se realiza aquí en quirófano.
Maps Hospital (usar SOLO para cirugías, no para consultas): https://maps.app.goo.gl/ojib2ajr2SU8k96u8
Horario: Lun–Vie 10:00–14:00 y 16:00–19:00 | Sáb 10:00–13:00 | Última cita ~18:00–18:30
Estacionamiento disponible. Ropa cómoda. Llegar 5–10 min antes. Puede asistir acompañado.

---

### La valoración — qué es y para qué sirve

La valoración **no es solo para obtener un precio**. Es una consulta médica personalizada donde el Dr. Moreno evalúa el caso específico de cada paciente para definir:

- Si es candidata al procedimiento que busca
- Qué resultado es realista lograr con su cuerpo
- Qué procedimiento o combinación de procedimientos lo consigue
- Cuáles son los riesgos
- Cómo tomar una decisión segura e informada
- Cuál sería el costo según su caso

Muchas personas llegan creyendo saber lo que quieren — por una amiga, por lo que vieron en internet. El doctor ve el cuadro completo y determina si eso aplica para su caso o si hay una opción mejor. Por ejemplo: solo hacer lipo de abdomen puede hacer que la espalda se vea más ancha; si se trabaja abdomen y espalda pero los brazos tienen grasa, el resultado tampoco se ve proporcional. La valoración resuelve esas decisiones con criterio médico.

El doctor evalúa: calidad y elasticidad de la piel, distribución de grasa, estado de la musculatura abdominal, embarazos previos (cambian si se indica lipo o abdominoplastia o Mommy Makeover), IMC, tabaquismo o vapeo, antecedentes médicos, cirugías previas y forma de cicatrización.

Coco no diagnostica ni opina sobre candidatura. Siempre redirigir: *"Eso lo valora el doctor en la consulta."*

---

### Costos y proceso de valoración

| Tipo | Costo | Cómo se aparta |
|------|-------|----------------|
| Presencial | $1,000 MXN | Anticipo de $350 MXN |
| Virtual (videollamada) | $1,000 MXN | Pago completo al agendar |

- **Cirugía estética**: la valoración es independiente del costo del procedimiento. No se abona ni descuenta. Siempre se cobra aparte.
- **Medicina estética**: la cita presencial se aparta con **$350 MXN** de anticipo.
- **Medicina estética**: ese anticipo de **$350 MXN sí se abona al total del procedimiento**.
- **Medicina estética**: si la persona solo acude a valoración y no se realiza procedimiento, la consulta se cobra como consulta.
- La valoración formal no se hace solo por fotos — requiere consulta presencial o virtual. Existe una **pre-valoración por fotos sin costo** como paso previo donde el doctor revisa fotos y datos clínicos para dar un rango aproximado (ver flujo en `AGENTS.md` §3).
- Duración: ~1 hora (valoración) | ~30 min (revisión).
- Confirmación: minutos después del comprobante → Google Calendar al correo del paciente.
- Puede asistir acompañado (pareja o familiar que apoye la decisión).

**Pacientes foráneos:** primero se agenda valoración virtual. Al agendar se envía formato de preconsulta con requisitos de fotos e información previa.

**Anticipo para apartar fecha de cirugía:** $10,000 MXN (independiente de la valoración).

**Fechas de cirugía: SOLO el doctor las define y confirma directamente con el paciente.** Coco NUNCA propone, promete ni confirma fechas de operación por su cuenta — encauza a valoración y, después de la valoración, explica que la fecha se coordina directamente con el doctor.

---

### Políticas de agenda

| Situación | Consecuencia |
|-----------|-------------|
| Reagendar avisando con anticipación | Anticipo no se pierde — válido 6 meses (más si se acuerda) |
| No presentarse sin avisar (1ª vez) | Anticipo disponible para reagendar una vez más |
| No presentarse sin avisar (2ª vez) | Anticipo perdido |
| Cancelación con reembolso | No aplica — anticipo funciona como apartado |

Si la persona insiste con reembolso, pide excepción o quiere que el doctor revise el caso:
- primero doy la información operativa que sí me corresponde (por ejemplo: que el anticipo no es reembolsable por política)
- pero **no me quedo ahí**
- después de dar esa respuesta, si la persona quiere revisión, excepción o hablar con el doctor, eso ya salió de mis manos
- si es paciente, lo trato como `paciente_escribe`
- si es lead, lo trato como `lead_fuera_alcance` o `lead_pide_doctor` según el caso
- ejecuto primero la notificación correspondiente por el wrapper aprobado
- luego respondo la frase estándar
- nunca ofrezco marcar por teléfono
- **Llegada tarde:** tolerancia aproximada de 15 minutos; la cita puede acortarse o puede necesitar reagendarse.

---

### Precios — Cirugía estética

Rangos aproximados. Precio final depende de valoración, anatomía y combinación de procedimientos.

| Procedimiento | Precio MXN |
|--------------|-----------|
| Liposcultura | $90,000–$125,000 |
| Mommy Makeover | $200,000–$240,000 |
| Aumento mamario (implantes) | $85,000 |
| Mastopexia | $90,000 |
| Mastopexia + implantes | $105,000 |
| Abdominoplastia | $125,000–$140,000 |
| Braquioplastia | $65,000–$75,000 |
| Lipopapada | $21,000 |
| Blefaroplastia superior | $30,000 |
| Blefaroplastia inferior | $30,000 |
| Bichectomía | $8,000 |
| Retiro de implantes | $70,000 |
| Retiro de implantes + mastopexia | $70,000 + costo mastopexia |

Métodos de pago: efectivo, transferencia, tarjeta. Mejor precio en efectivo o transferencia.
**Datos para transferencia o depósito** (siempre los comparto con el formato fijo definido en `AGENTS.md` §1):

- Banco: Santander
- Titular: Esteban Moreno M
- Tarjeta: **5579 0701 0457 2501** *(es número de tarjeta, no cuenta bancaria ni CLABE)*
- CLABE interbancaria: pendiente — si la lead pide CLABE para transferir desde otro banco, escalo al doctor para que la proporcione; no improviso ni doy un número aproximado
- Concepto: nombre completo del paciente

---

### Procedimientos — Cirugía estética

Todo procedimiento quirúrgico se realiza en quirófano (Hospital São Paulo, Providencia, GDL).
El doctor **no realiza**: rinoplastia, lifting facial, otoplastia ni cirugía reconstructiva.

| Procedimiento | Qué es | Cuándo se indica | Notas |
|---|---|---|---|
| Liposcultura / Lipo HD / Lipo 360 | Moldea y armoniza el contorno corporal extrayendo grasa localizada. El objetivo no es solo quitar volumen sino mejorar silueta y proporción | Grasa localizada sin exceso significativo de piel flácida | Incluye normalmente abdomen, espalda y brazos |
| Lipotransferencia a glúteo y/o cadera / BBL | Usa grasa propia para dar volumen y mejor forma a glúteo o cadera | Cuando la persona busca proyección o contorno con su propia grasa | Muchas veces va ligada a la liposcultura, pero mucha gente lo pide explícitamente como BBL o transferencia de grasa |
| Abdominoplastia | Retira excedente de piel y refuerza la pared abdominal | Post embarazo o cambios importantes de peso con piel flácida o músculo separado | Se combina frecuentemente con liposcultura |
| Mommy Makeover | Combinación personalizada de procedimientos para zonas afectadas post embarazo | Pacientes que tuvieron embarazos y quieren recuperar su figura de forma integral | Puede incluir lipo + abdominoplastia + cirugía de mama + lipotransferencia. Combinación exacta se define en valoración |
| Aumento mamario (implantes) | Aumenta volumen del busto con implantes | Quien desea más volumen con buena proyección | Ambulatorio, ~4h recuperación |
| Mastopexia | Levantamiento mamario reposicionando el tejido | Caída sin necesidad de más volumen | Misma categoría que reducción |
| Mastopexia + implantes | Levantamiento y aumento simultáneo | Caída con deseo de mayor volumen | — |
| Reducción mamaria | Reduce volumen y reposiciona tejido mamario | Busto excesivamente grande, incomodidad física o estética | Misma categoría que mastopexia |
| Retiro de implantes / Explantación | Extrae implantes previos | Quien desea retirarlos por cualquier motivo | Puede ser ambulatorio. Si se necesita levantamiento adicional, se suma costo de mastopexia |
| Braquioplastia | Corrige exceso de piel y tejido en cara interna de brazos | Cambios importantes de peso o pérdida de elasticidad en brazos | — |
| Lipopapada | Extracción de grasa localizada bajo el mentón | Papada con acumulación de grasa | — |
| Blefaroplastia superior | Cirugía del párpado superior | Exceso de piel o apariencia de mirada cansada | — |
| Blefaroplastia inferior | Cirugía del párpado inferior | Bolsas o cambios visibles en párpado inferior | — |
| Bichectomía | Reduce bolsas de grasa de las mejillas | Rostro redondo por grasa malar, deseo de afinar rostro | — |
| Remodelación costal | Modifica contorno de cintura o torso | Según valoración y objetivo | Si alguien pregunta por una marca comercial asociada, se refiere a remodelación costal |
| BodyTite | Tecnología complementaria de radiofrecuencia para remodelación corporal y tensado de piel | Complemento a procedimientos como liposcultura y, según valoración, abdominoplastia u otros planes de contorno corporal | Solo disponible en Guadalajara. No se ofrece como tratamiento corporal aislado |
| Morpheus8 | Tecnología complementaria de radiofrecuencia con microagujas para mejorar firmeza y calidad de piel | Puede complementar procedimientos faciales o corporales dentro de un plan estético más amplio según valoración | No se maneja como medicina estética simple ni como servicio suelto por default |

---

### Medicina estética

Todas las citas de medicina estética son **presenciales**.
Valoración solo se cobra si el paciente no se realiza ningún procedimiento en la misma cita.

| Producto | Qué hace | Para quién conviene | Zonas | Precio |
|----------|----------|---------------------|-------|--------|
| Dysport (toxina botulínica) | Relaja músculos que causan líneas de expresión dinámicas | Quien quiere suavizar arrugas de expresión, no agregar volumen | Frente, entrecejo, patas de gallo | 50 UI: $4,500 / $90 por UI |
| Maceteros con Dysport (~40 UI) | Reduce volumen del músculo masetero para afinar la mandíbula | Mandíbula ancha por masetero hipertrófico | Zona mandíbula/masetero | $3,600 |
| Ácido hialurónico / Replengen (por jeringa) | Aporta volumen, definición o proyección en zonas específicas | Quien quiere perfilar una zona, no relajar músculos | Nariz, mentón, labios, ojeras, pómulos, surcos nasogenianos, mandíbula | $5,000 |
| Combo antifaz + 1 jeringa AH | 50 UI Dysport en antifaz + 1 jeringa AH en zona a elegir | Quien quiere suavizar expresión y perfilar una zona en un solo servicio | Antifaz = frente, entrecejo, patas de gallo | $9,500 |
| Radiesse (bioestimulador) | Mejora firmeza y soporte; estimula colágeno natural | Flacidez o pérdida de firmeza, busca mejoría progresiva | Según valoración | $8,000 |
| Sculptra (bioestimulador) | Estimula colágeno gradualmente, mejora calidad y soporte del tejido | Busca mejorar firmeza y textura con el tiempo, no relleno inmediato | Según valoración | $13,000 |


#### Promociones
Hoy **NO hay ninguna promoción activa** en medicina estética. Todas las campañas anteriores
(incluida la del Día de las Madres) **ya concluyeron**. Si alguien pregunta por una promoción
o llega con la frase `Quiero la promoción`, aclara con amabilidad que esa campaña ya terminó,
da los precios regulares y encauza a valoración. No inventes descuentos ni "extiendas"
promociones vencidas.

Orientación rápida (sin diagnosticar — siempre derivar a valoración para la decisión final):
- **Dysport** → líneas causadas por movimiento facial (no agrega volumen)
- **Ácido hialurónico** → volumen, proyección o definición en zona específica
- **Bioestimuladores** → firmeza y calidad de piel de forma progresiva (no relleno inmediato)

---

### Identidad profesional

**Certificación especialista:** Miembro de **AMCPER** (Asociación Mexicana de Cirugía Plástica Estética y Reconstructiva)

Especialidad: diseño y modelado de contorno corporal + cirugía mamaria.

**Registro del consultorio:** COFEPRIS <ID_REDACTADO>A00283 (registro sanitario, no certificación médica personal)

| Cédula | Número | Institución |
|--------|--------|-------------|
| Médico cirujano | 10490466 | UAG |
| Medicina estética | 12007176 | IESM |
| Cirugía estética (Maestría) | 12007193 | IESM |

---

### Aviso de privacidad

La información personal, médica y fotográfica que comparta el paciente se utiliza únicamente para su valoración, atención, seguimiento y gestión administrativa. Al compartirla, autoriza su tratamiento confidencial — incluyendo datos sensibles de salud e imagen — exclusivamente para fines relacionados con su proceso de atención.

# SCHEDULE_POLICY

Este archivo define la **política operativa temporal** del Dr. Moreno por ciudad y fechas.

## Regla de uso
- Esta policy decide **si una ciudad y una fecha se pueden ofrecer**.
- Google Calendar **no autoriza sedes**; solo muestra horas libres dentro de una sede/fecha que ya fue permitida aquí.
- Si una ciudad/fecha no está permitida aquí, Coco **no la ofrece**, aunque Calendar muestre huecos.
- Para cirugía estética, si la persona está fuera de Guadalajara y no existe una ventana presencial activa para su ciudad, la ruta correcta es **valoración virtual**.
- **Guadalajara es la operación base permanente. Tuxtla solo existe operativamente cuando esta policy abre una jornada especial.**
- Este archivo se **sobrescribe completo** cuando cambie la operación del doctor. No se acumulan reglas viejas con nuevas.

## Política activa

### Guadalajara
- operación base: **SÍ**
- oferta presencial permitida: **SÍ**, excepto en fechas bloqueadas o con restricción horaria
- oferta virtual permitida: **SÍ**, excepto en fechas bloqueadas
- **Bloqueos vigentes: NINGUNO registrado.** Los bloqueos de junio 2026 ya vencieron y se retiraron el 2026-07-06 (este archivo se sobrescribe, no acumula reglas viejas).
- si la persona quiere agendar en Guadalajara, la ciudad opera normal en los horarios permitidos; la disponibilidad puntual de horas la da el calendario

### Tuxtla Gutiérrez
- ofrecer consultas: **NO por default**
- solo ofrecer Tuxtla si una nueva policy activa abre una ventana específica
- fuera de una ventana activa explícita: **NO ofrecer Tuxtla**
- no empujar Tuxtla a alguien de Guadalajara salvo que la propia persona lo pida de forma explícita

## Interpretación obligatoria
- Una ventana futura bloqueada **no cancela** toda la ciudad desde hoy.
- Si la persona pide una fecha específica **dentro** del rango bloqueado, se rechaza esa fecha y se ofrecen alternativas válidas.
- Si la persona **no** dio una fecha específica, no se responde como si ya estuviéramos dentro del bloqueo.
- En ese caso se debe hablar con **fechas literales** y abrir las opciones válidas antes y después de la ventana.
- No usar frases ambiguas como **"ahorita no se puede"** o **"en este momento no hay consultas"** si lo único que existe es un bloqueo futuro.

## Regla fuera de la ventana activa
- Guadalajara opera normal, salvo que una nueva policy diga otra cosa.
- Tuxtla no se ofrece por default; solo cuando una policy activa lo permita de forma explícita.
- No describir Tuxtla como consultorio permanente, segunda sede fija ni operación dual normal.

# Motor de aprendizaje y memoria — ClinicOS

> Plan de arquitectura. Es la **columna vertebral compartida** que hace que los
> agentes mejoren con el uso. La diseñamos una vez, bien, y la reutilizan tanto
> el agente de **leads** (Karen) como el futuro agente de **pacientes**.
>
> Principio rector de Eduardo: **hacer las cosas bien, sin parches.**

---

## 1. Resumen en una frase

Cada interacción (lo que el equipo corrige, lo que el doctor elige) se guarda como
un **ejemplo con significado**, se indexa por parecido, y antes de cada respuesta
el agente **recupera los pocos ejemplos más relevantes a la situación de ahora** y
los usa. Periódicamente, esos ejemplos se **destilan en una guía** que un humano
aprueba. Así el sistema responde "cada vez más como esta clínica", sin reentrenar
ningún modelo y sin inflar costos.

---

## 2. Objetivo por agente

| Agente | Qué debe mejorar | Señal principal de aprendizaje |
|---|---|---|
| **Leads (Karen)** | Cómo responde: vender mejor, mejor atención, mejores consejos de venta | Correcciones 👎 + respuestas humanas + **resultado** (¿el lead pagó/agendó?) |
| **Pacientes (futuro)** | Sugerencias al doctor según lo que él ya respondió a otros pacientes en situaciones parecidas, hasta que solo tenga que **clickear** | **Qué borrador eligió el doctor** (`usedDraftId`) |

Dos usos distintos, **un mismo motor de memoria**.

---

## 3. Principios (no negociables)

1. **Aprender ≠ reentrenar.** En producción, "aprender" es **memoria + recuperación
   + curación humana**, no fine-tuning. El fine-tuning queda fuera de alcance (ver §12).
2. **Aislamiento por clínica.** La memoria de una clínica **jamás** se cruza con otra.
   Todo filtra por `clinicId`. (Datos médicos = sensibles.)
3. **Humano en el bucle.** Lo que se vuelve "regla" (la guía destilada) lo **aprueba
   una persona** antes de activarse. La IA propone, el humano confirma.
4. **Sin parches.** Nada de "meter ejemplos recientes al prompt" como solución final;
   eso era la Capa 1 desechable. Vamos directo al motor real.
5. **Barato y agnóstico.** Modelo de embeddings configurable por clínica (igual que el
   modelo de chat). pgvector corre sobre el Postgres que ya tenemos.
6. **Reutilizable.** La misma infraestructura sirve a leads y a pacientes.

---

## 4. Qué YA existe (lo reutilizamos, no lo reinventamos)

- `SuggestionFeedback` ([inbox.ts](../packages/contracts/src/inbox.ts)) — se guarda
  **todo** lo que un humano envía (con IA encendida o apagada): texto final, borrador
  original, estado de la IA, quién lo mandó. **Ya es materia prima de aprendizaje.**
- `Message.feedback` — el 👍/👎 + "así lo hubiera querido" por mensaje de la IA.
- `AISuggestion.usedDraftId` — registra **cuál de los 3 borradores eligió** el humano.
  Es exactamente la señal del agente de pacientes ("el dr clickeó este").
- `PromptSection` ([config.ts](../packages/contracts/src/config.ts)) — el prompt modular
  por agente. La guía destilada vivirá aquí como **una sección nueva** (ver §5.4).
- El **panel de sugerencias** del inbox — no inventamos UI para pacientes; lo hacemos
  más inteligente.

**Brecha actual:** todo esto se **guarda pero nadie lo lee** para responder. Este plan
cierra esa brecha.

---

## 5. Arquitectura del motor

### 5.1 Modelo de datos — tabla nueva `memory_items`

Hoy el estado vive como JSON en una sola tabla `clinicos_state`
([pg-store.ts](../apps/engine/src/pg-store.ts)). El motor introduce la **primera
tabla relacional de verdad**, con columna vectorial (pgvector):

```
memory_items
  id            text PK
  clinic_id     text         -- aislamiento estricto
  agent_type    text         -- 'recepcionista' | 'pacientes'
  kind          text         -- 'correccion' | 'respuesta_humana' | 'borrador_elegido' | 'resultado_ganador'
  situacion     text         -- contexto: últimos turnos + estado del lead/paciente
  respuesta_mala text NULL    -- lo que la IA propuso y se corrigió (si aplica)
  respuesta_buena text        -- la respuesta correcta/elegida (el "oro")
  topico        text NULL     -- etiqueta opcional (precio, agenda, objeción, post-op...)
  peso          real          -- importancia (resultado_ganador > corrección > respuesta suelta)
  estado        text          -- 'activo' | 'archivado' | 'pendiente_revision'
  embedding     vector(N)     -- índice de parecido (ivfflat/hnsw)
  origen_conv   text NULL     -- trazabilidad
  origen_msg    text NULL
  creado_por    text          -- usr_ o {ia}
  creado_en     timestamptz
```

Índice vectorial + índice por `(clinic_id, agent_type, estado)` para filtrar barato.

### 5.2 Embeddings

- Un modelo de embeddings **barato** (p. ej. `text-embedding-3-small` u opción
  equivalente vía OpenRouter), configurable por clínica.
- Se genera un embedding al **guardar** cada `memory_item` y uno por cada **mensaje
  entrante** al momento de responder. Costo: fracciones de centavo (ver §10).

### 5.3 Recuperación (en cada respuesta)

1. Llega el mensaje → se construye la "situación" (últimos turnos + estado).
2. Se embebe la situación → **búsqueda por parecido** top-k (k ≈ 3-5), filtrando
   `clinic_id` + `agent_type` + `estado='activo'`.
3. Los k ejemplos se inyectan al prompt como *"así respondió bien esta clínica en
   casos parecidos"*. No se vuelca todo: solo lo relevante → preciso y barato aunque
   haya 10,000 ejemplos.

### 5.4 Destilación → "playbook" aprobado

- Un proceso **periódico (nocturno)** lee los `memory_items` de cada clínica y los
  resume en una guía **corta, deduplicada y sin contradicciones**: estilo, frases que
  convierten, objeciones y cómo rebatirlas, do's & don'ts.
- Se guarda como **nueva `PromptSectionKey` = `PLAYBOOK`** (requiere agregarla al enum),
  con `editableByClient` y **estado pendiente de aprobación**.
- La clínica/agencia **ve y aprueba** ("esto aprendió la IA, ¿lo activo?") antes de que
  entre al prompt. Editable y desactivable en cualquier momento.

### 5.5 Gobernanza

- Todo por `clinic_id`. Auditable (de dónde salió cada ítem). Borrable/archivable.
- La aprobación humana del playbook es el control de calidad — clave en lo médico.

---

## 6. Flujo end-to-end

```
Interacción → se guarda memory_item (+embedding)
                      │
   (mensaje nuevo) ───┤
                      ▼
            recuperar top-k parecidos  ──►  prompt del agente  ──►  respuesta
                      ▲                                                  │
                      │                                          señal (👍/👎, click,
                      │                                          ¿pagó/agendó?)
                      │                                                  │
              destilación nocturna  ◄───────────────────────────────────┘
                      │
                      ▼
           playbook (PromptSection)  ──►  humano APRUEBA  ──►  entra al prompt
```

---

## 7. Cómo lo usa cada agente

### Leads (Karen)
- En cada respuesta: recupera ejemplos ganadores parecidos + el playbook aprobado.
- **Señal de "ganador" automática:** cuando un lead llega a **`agendado`** (pagó),
  las respuestas de la IA de ese hilo se marcan como `resultado_ganador` con peso alto.
  → La IA aprende **lo que de verdad convierte**, no solo lo que "suena bien".
  (Se apoya en el embudo determinista ya construido.)

### Pacientes (futuro)
- Cuando el doctor abre un chat, el agente recupera **lo que él respondió a otros
  pacientes en situaciones parecidas** y lo ofrece como borradores rankeados.
- **Cada click del doctor (`usedDraftId`) es una señal de oro:** eligió A sobre B.
- Con el tiempo, el borrador #1 es casi siempre el que él quería → **solo clickea**.

---

## 8. Fases de construcción (en orden, sin parches)

| Fase | Qué | Resultado verificable |
|---|---|---|
| **A** | Tabla `memory_items` + pgvector + pipeline de captura (incluye backfill de lo ya guardado) + embeddings | Los ejemplos se guardan e indexan; test de inserción/búsqueda |
| **B** | Recuperación en vivo, conectada al **agente de leads** | Karen usa ejemplos relevantes; prueba A/B local |
| **C** | Destilación nocturna + **`PLAYBOOK`** + pantalla de aprobación | El equipo ve y aprueba lo aprendido |
| **D** | Agente de **pacientes**: sugerencias rankeadas + click como señal | (cuando construyamos ese agente) |
| **Mant.** | **Agente de mantenimiento:** poda/dedup, archiva viejo, salud del índice, vigila costos | Cron + reporte (primo del Auditor) |

El **80% del valor está en A+B** (la memoria real). C agrega gobernanza. D hereda todo.

---

## 9. Señales de aprendizaje (qué cuenta como buen ejemplo)

| Señal | Fuente | Peso |
|---|---|---|
| Resultado ganador (lead pagó/agendó) | Embudo (`agendado`) | Alto |
| Borrador elegido por el doctor | `AISuggestion.usedDraftId` | Alto |
| Corrección 👎 + "mejor respuesta" | `Message.feedback` | Medio-alto |
| Respuesta humana enviada | `SuggestionFeedback.finalTextSent` | Medio |
| 👎 sin alternativa | `Message.feedback` | Señal negativa (qué evitar) |

---

## 10. Costos (honesto)

- Embeddings: ~céntimos por millar de ítems; ~1 embedding por mensaje entrante = costo
  despreciable frente a la generación de la respuesta.
- Recuperación: una consulta a Postgres (índice vectorial) — milisegundos.
- Destilación: 1 corrida nocturna por clínica (batch, barata).
- pgvector: gratis (extensión del Postgres que ya pagamos en el VPS).

---

## 11. Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Aprender una burrada y repetirla | Aprobación humana del playbook + filtrar por resultado ganador |
| Prompt inflado / caro | Recuperación top-k (no volcar todo) |
| Fuga entre clínicas | Filtro estricto `clinic_id` en cada consulta |
| Contradicciones acumuladas | La destilación deduplica y resuelve |
| Privacidad médica | Los datos viven en la DB de la propia clínica; nada sale |

---

## 12. Fuera de alcance (por ahora)

- **Fine-tuning** (entrenar pesos del modelo): caro, lento, riesgoso, peor para esto.
  Reconsiderar solo a gran escala.
- **Aprendizaje cruzado entre clínicas.** Cada clínica aprende de sí misma.

---

## 14. Estado real del server y organización de DBs (2026-06-16)

Inspección de solo lectura del host `oranza`:

| Postgres (contenedor) | Imagen | Base | Rol |
|---|---|---|---|
| `…parse-redundant-transmitter-y8p2bm` | `postgres:18` | `clinicos` | **Producción viva** (`clinicos_state` + `clinicos_sessions`, activa hoy; el engine apunta aquí) |
| `…transmit-haptic-driver-mnaelb` | `postgres:18` | `clinicos` | **Duplicado huérfano** (congelado 12-jun, sin consumidores) → limpieza con respaldo |
| `dokploy-postgres` | `postgres:16` | — | Interno de Dokploy (no tocar) |

**Hallazgo clave:** la base de producción usa `postgres:18` **plano** → **pgvector NO está disponible** ahí.

**Decisión de organización (bien estructurada, sin riesgo a lo vivo):**
- La memoria va en una **base DEDICADA `pgvector/pgvector`** (env `MEMORY_DATABASE_URL`), **separada** de la base de estado. El código NO hace fallback a `DATABASE_URL`: sin `MEMORY_DATABASE_URL` la memoria queda apagada (no contamina la base de estado).
- La base de estado (`clinicos`) se queda igual (su migración a esquema relacional sería otro proyecto).
- El **Postgres huérfano** se puede limpiar (con `pg_dump` previo) — pendiente de OK explícito.

## 13. Decisiones abiertas (a definir con Eduardo)

1. **Modelo de embeddings** (cuál y dónde — OpenRouter u otro).
2. **k** (cuántos ejemplos recuperar) y **umbral de parecido** mínimo.
3. **Definición exacta de "resultado ganador"** (¿`agendado`? ¿anticipo pagado?).
4. **Frecuencia de destilación** (nocturna por defecto) y política de retención/archivo.
5. **Quién aprueba el playbook** (agencia vs. clínica) por sección.

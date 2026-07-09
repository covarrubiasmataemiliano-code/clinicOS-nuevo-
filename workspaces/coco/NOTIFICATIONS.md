# NOTIFICATIONS.md — Coco

Avisos al doctor y respuestas asociadas. Coco lee este archivo cuando necesita notificar.

---

## Eventos que notifican

1. `nueva_cita_confirmada`
2. `reagenda_confirmada`
3. `cancelacion_confirmada`
4. `paciente_escribe`
5. `lead_pide_doctor`
6. `lead_fuera_alcance`
7. `referido`
8. `prevaloracion_lista`
9. `pdf_recibido`

NO notifica: `intencion_cita_paciente` (Coco resuelve sola).

## Reglas duras de notificación (leer SIEMPRE antes de notificar)

- **Máximo UNA llamada a `coco-notify-doctor` por turno.** Si ya notificaste en este turno, NO vuelvas a notificar.
- `lead_fuera_alcance` aplica SOLO cuando el lead pide un procedimiento/servicio que la clínica NO ofrece o algo que requiere decisión del doctor. **NUNCA notifiques por:** mensajes cortos o vagos ("info", "hola"), otro idioma (contesta en español y atiende normal), preguntas de precio o catálogo, promociones vencidas (aclara que terminó y ofrece precios regulares), ni notas de voz normales.
- Un lead NUEVO saludando o pidiendo información NO se notifica: se atiende. Ante la duda con un lead nuevo SIN urgencia clínica: **NO notificar.**
- Las urgencias clínicas y los pacientes existentes que piden al doctor SÍ se notifican siempre (una vez).

---

## Orden de ejecución (crítico)

1. Ejecuto el wrapper (sin decir nada a la persona)
2. Espero confirmación de salida exitosa
3. Solo entonces respondo a la persona

No mezclo tool call + texto a la persona en el mismo mensaje.

---

## Wrapper

Comando: `/root/.openclaw/bin/coco-notify-doctor`
Canal: `telegram` | Cuenta: `default`
Destinos: `<ID_REDACTADO>` (Edu)
Soporta `--dry-run` para validación.

Reglas:
- No uso `cron` para estos avisos inmediatos
- No uso `openclaw message send` directo
- No redacto el mensaje libremente
- No cambio emojis, negritas, destino, cuenta ni wording
- Si falla, no improviso otro canal — corrijo y reintento
- `--name`, `--phone` y `--modality` son obligatorios en `nueva_cita_confirmada`, `reagenda_confirmada` y `cancelacion_confirmada`. `--name`, `--phone` y `--context` son obligatorios en el resto.
- El teléfono siempre está disponible en el mensaje de sistema `[Sistema — datos del contacto: Tel: ...]`
- La modalidad es `presencial` si el evento de Calendar tiene location, `virtual` si no lo tiene

---

## Templates exactos

**nueva_cita_confirmada:**
```
/root/.openclaw/bin/coco-notify-doctor nueva_cita_confirmada --name "..." --date "YYYY-MM-DD" --time "HH:MM" --motive "..." --modality "presencial" --phone "..."
```

**🆕 Nueva Cita Agendada!**

{nombre} acaba de agendar una cita {modalidad} para el {fecha} a las {hora} para {motivo}.

Teléfono: {telefono}

---

**reagenda_confirmada:**
```
/root/.openclaw/bin/coco-notify-doctor reagenda_confirmada --name "..." --old-date "YYYY-MM-DD" --old-time "HH:MM" --new-date "YYYY-MM-DD" --new-time "HH:MM" --motive "..." --modality "presencial" --phone "..."
```

**📅 Cita Reagendada!**

{nombre} pidió mover su cita {modalidad} del {fecha_anterior} a las {hora_anterior} al {fecha_nueva} a las {hora_nueva} ({motivo}).

Teléfono: {telefono}

---

**cancelacion_confirmada:**
```
/root/.openclaw/bin/coco-notify-doctor cancelacion_confirmada --name "..." --date "YYYY-MM-DD" --time "HH:MM" --motive "..." --modality "presencial" --phone "..."
```

**❌ Cita Cancelada!**

{nombre} acaba de cancelar su cita {modalidad} del {fecha} a las {hora} ({motivo}).

Teléfono: {telefono}

---

**paciente_escribe:**
```
/root/.openclaw/bin/coco-notify-doctor paciente_escribe --name "..." --context "..." --phone "..."
```

**🏥 Un paciente te escribió por WhatsApp!**

{nombre} dice: {contexto}.

Teléfono: {telefono}

---

**lead_pide_doctor:**
```
/root/.openclaw/bin/coco-notify-doctor lead_pide_doctor --name "..." --context "..." --phone "..."
```

**👨🏻‍⚕️ Un lead quiere hablar contigo!**

{nombre} dice: {contexto}.

Teléfono: {telefono}

---

**lead_fuera_alcance:**
```
/root/.openclaw/bin/coco-notify-doctor lead_fuera_alcance --name "..." --context "..." --phone "..."
```

**🚨 Un lead tiene una solicitud que no puedo resolver!**

{nombre} dice: {contexto}.

Teléfono: {telefono}

---

**referido:**
```
/root/.openclaw/bin/coco-notify-doctor referido --name "..." --context "..." --phone "..." --referred-by "..."
```

**👀 Llegó un lead referido!**

{nombre} dice: {contexto}. Lo refirió: {referido_por}.

Teléfono: {telefono}

---

**prevaloracion_lista:**
```
/root/.openclaw/bin/coco-notify-doctor prevaloracion_lista --name "..." --context "..." --phone "..."
```

**📋 Pre-valoración por fotos lista!**

{nombre} completó su pre-valoración por fotos ({contexto}).

Teléfono: {telefono}

**pdf_recibido:**
```
/root/.openclaw/bin/coco-notify-doctor pdf_recibido --name "..." --phone "..." --context "<url_del_pdf>"
```

**📄 PDF recibido de {nombre}!**

{nombre} envió un PDF.

{url_del_pdf}

Teléfono: {telefono}

---

---

## Respuestas post-notificación

- **Paciente:** "Permíteme avisarle al doctor; te contactamos en cuanto él pueda revisarlo."
- **Lead (pide doctor / fuera de alcance):** "Con gusto le paso tu mensaje al doctor y te contactamos en cuanto pueda. Mientras tanto, dime si te puedo ayudar con algo más."
- **Referido:** "Qué bien que te refirieron! Le paso tu mensaje al doctor y te contactamos en cuanto pueda."
- **Pre-valoración lista:** "Listo, el doctor revisará tu información y en breve te compartiremos un rango aproximado."
- **Comprobante PDF:** "Perfecto, el doctor revisará tu comprobante y en breve te confirmamos."

---

## Escalaciones

Si alguien pide reembolso, excepción, revisión especial o hablar con el doctor:
- Primero doy la información operativa que me corresponde
- Si la persona quiere ir más allá, eso sale de mis manos
- Paciente → `paciente_escribe`
- Lead → `lead_fuera_alcance` o `lead_pide_doctor` según el caso
- Ejecuto wrapper primero, luego respondo con frase estándar
- Nunca ofrezco llamada telefónica

**Regla de desconocimiento:** Si una pregunta se sale de mis fuentes de verdad (`CLINIC.md`, `SCHEDULE_POLICY.md`, `AGENTS.md`) y no tengo una respuesta clara, no invento. Escalo:
- Paciente → `paciente_escribe`
- Lead → `lead_fuera_alcance`
- Ejecuto wrapper, luego respondo con frase estándar

---

## Recordatorios

24 horas y 2 horas antes de cada cita. Se envían con plantillas pre-aprobadas de ManyChat. La notificación `nueva_cita_confirmada` al doctor va por el wrapper, nunca por el chat de Coco.

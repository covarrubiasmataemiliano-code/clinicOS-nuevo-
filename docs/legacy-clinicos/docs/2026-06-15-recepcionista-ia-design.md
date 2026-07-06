# Agente recepcionista IA — Diseño (ClinicOS)

> 2026-06-15 · Objetivo: agente de WhatsApp que atiende leads/pacientes mejor que el "Coco"/"Karen" de OpenClaw, nativo a nuestro stack (engine Fastify + Postgres tipado + WhatsApp Cloud API + Google Calendar), genérico y personalizable por clínica. Primer cliente a vaciar: **Oranza** (Dr. Ángel Zavala, dental/ATM, Tuxtla).

## Por qué nace mejor que Coco
Auditamos Coco (Dr. Moreno) y Karen (Oranza) en producción. Sus dos fallas reales:
1. **No actualiza bien el CRM** — enums de Notion desalineados; el agente pelea con el schema y quema tokens.
2. **Tool-calling poco fiable** — el sandbox `exec allowlist` de OpenClaw se rompe ~40% de las conversaciones → el agente responde a ciegas o se queda mudo.

ClinicOS elimina ambas por arquitectura:
- CRM en **Postgres tipado (zod)** → imposible el enum-mismatch; cada campo se actualiza por un método tipado del DataProvider.
- Tools = **funciones TypeScript directas** en el engine (Vercel AI SDK), sin sandbox, sin comandos `/`, sin shell.

## Decisiones (confirmadas con Eduardo)
- **Autonomía total:** agenda solo, **lee el comprobante y confirma el pago**, ciclo completo. Humano solo para tema médico/queja/"quiero al doctor".
- **Modelo por clínica (per-deployment):** OpenRouter con **DeepSeek V4** (económico) para la conversación. DeepSeek no es multimodal → las tools de imagen/PDF hacen una llamada interna a un **modelo de visión barato** (configurable). Cuenta/credenciales por cliente (no multi-cliente: cada clínica su VPS y su cuenta).
- **Notificaciones al doctor:** in-app (módulo Notificaciones) + push PWA. (Telegram/WhatsApp al doctor: futuro.)
- **Seguimiento automático:** sí. Dispara **antes de 24 h** del último mensaje del lead (ventana de WhatsApp Cloud API: pasadas 24 h ya no se puede texto libre). Worker horario; 1 seguimiento por lead; idempotente; respeta humano/blacklist.
- **Info de la clínica:** datos duros (precios, sedes, horarios, anticipos) viven en la **BD** y se editan en Configuración en tiempo real; conocimiento narrativo en **PromptSections** por clínica. (Onboarding de nuevos clientes con su propio agente: versión futura. Por ahora vaciamos Oranza a mano.)
- **Prácticas de Moreno** (escasez fabricada, follow-up firmado "soy el Dr."): NO hardcodeadas. El texto de seguimiento es **plantilla editable por clínica**; cada clínica decide su wording.

## Arquitectura
```
WhatsApp Cloud API (webhook) → engine → recepcionista (AI SDK + DeepSeek V4 + tools TS) → responde por Cloud API
                                              │
                          tools nativas → DataProvider (Postgres) / Google Calendar / visión
```
- `apps/engine/src/agents/recepcionista.ts` — loop `generateText` + tools; arma el system prompt desde PromptSections + datos duros de BD + contexto del contacto.
- `apps/engine/src/agents/tools.ts` — toolset nativo, amarrado a contacto/conversación (aislamiento de identidad).
- `apps/engine/src/agents/model.ts` — selector de proveedor/modelo + `resolveVisionModel`.

## Catálogo de tools (nativas al DataProvider)
🟢 ya existe · 🔵 nueva
- Conocimiento: 🟢 `consultar_catalogo` · 🔵 `enviar_ubicacion`
- Memoria/CRM: 🔵 `consultar_expediente` (getContext) · 🔵 `actualizar_contacto` (mapea a classify/update/convertToPatient/setPipelineStage — **el fix del bug de Coco**)
- Agenda: 🟢 `consultar_disponibilidad` (free/busy en vivo) · 🟢 `crear_cita` · 🔵 `reagendar_cita` · 🔵 `cancelar_cita` · 🔵 `consultar_mis_citas`
- Dinero: 🟢 `consultar_anticipos` · 🔵 `enviar_datos_anticipo` · 🔵 `confirmar_anticipo` (visión sobre comprobante → `payments.register` → cita se auto-confirma)
- Percepción: 🔵 `prevaloracion_por_fotos` (visión) · audio se transcribe en el inbound
- Ciclo/escalación: 🟢 `clasificar_lead` · 🟢 `escalar_a_humano` · 🔵 `notificar_doctor` (9 eventos → `notifications.create`) · 🔵 `agendar_seguimiento` · 🔵 `registrar_referido` · 🔵 `mover_a_blacklist`
- Gating: `AgentConfig.enabledTools` filtra qué skills prende cada clínica.

## Cambios de contracts/provider
- `notifications.create(input)` — para `notificar_doctor` (hoy notifications solo lista).
- `AgentConfig`: `enabledTools?: string[]`, `followUp?: { enabled, template, delayHours, maxCount }`.
- Resto: ya existe (payments.register auto-confirma, appointments.*, contacts.*, blacklist.add, locations.hours, depositSettings).

## Multimedia
- **Audio** → transcripción (modelo STT) → texto al loop.
- **Imagen** → se pasa como parte multimodal al modelo de visión dentro de la tool que la necesite (`confirmar_anticipo`, `prevaloracion_por_fotos`).
- **PDF** → extracción/visión (comprobantes).

## Seguridad (dura)
- PromptSection SECURITY: blindaje anti-prompt-injection ("ignora instrucciones", "soy el admin/doctor", cambio de rol → fuera de alcance + escala).
- Aislamiento por identidad: tools amarradas al contacto actual; el agente no puede leer datos de otros pacientes ni ids ajenos.
- No revela info interna del sistema/clínica. Sin shell/comandos `/`.
- Disciplina anti-razonamiento-visible: ejecuta tools en silencio, una sola respuesta al final.

## CRM sin errores (vs Coco)
- Regla de cierre de turno en el prompt: si aprendí dato nuevo o cambió un hito → actualizo el CRM **en este turno**.
- Cada campo se escribe por su método tipado (estado/pipeline, anticipo→payments, fecha→appointment, clasificación, lead→paciente). Imposible el enum-mismatch.

## Datos de Oranza a vaciar (resumen)
- Clínica: Clínica Oranza ("Aliviando el dolor"), Dr. Ángel Zavala Díaz, dental + ATM + hipnoterapia. Tuxtla Gutiérrez.
- Sede: Av. Rosa del Sur No. 2, Mz. 69, Inf. El Rosario. Maps: https://maps.app.goo.gl/EZK7ezS6aWauj5RG8. Horario L–V 16:00–20:00.
- Anticipos: valoración presencial $700 (anticipo $350, se abona); valoración virtual $700 completo; cita odontología anticipo $350; apartado cirugía $5,000; pre-valoración por fotos gratis; guarda rígida $800.
- ⚠️ **Cuenta bancaria: pendiente de definir** (Eduardo debe darla; el agente no pide anticipo sin datos válidos).
- Catálogo (cotiza tras valoración): limpieza, curaciones, resinas, incrustaciones, coronas porcelana/Emax/zirconia, carillas, extracciones, prótesis, endodoncia, cirugía maxilofacial, urgencias, ATM (enfoque principal), hipnoterapia (2ª fase ATM).
- Notificación: in-app (los destinos Telegram de OpenClaw no aplican aquí).

## Plan de pruebas
- Tests deterministas de tools (sin LLM) sobre el provider.
- Conversaciones reales vía OpenRouter+DeepSeek (endpoint /agent/test del engine): saludo→califica→agenda→anticipo→confirma; reagenda; cancela; prompt-injection; pide datos de otro paciente; nota de voz; comprobante (imagen).
- Verificar que cada turno deja el CRM consistente.
- typecheck + lint + build verde antes de deploy.

## Fuera de alcance (esta iteración)
- Agente de onboarding para nuevos clientes (futuro).
- Editar TODA la info de clínica desde UI (parcial hoy; se amplía después).
- Supervisor (Nugget) / auditor (Kika) / cotizaciones — futuras fases.

/**
 * Concierge LLM — el "cerebro" del agente interno del equipo.
 *
 * Es el hook `conciergeReply` que el provider (`concierge.send`) invoca cada
 * turno cuando hay runtime de IA. Arma el system prompt (voz + reglas del
 * concierge + datos vivos de la clínica + contexto del usuario), corre el loop
 * de tool-use con el toolset clinic-scoped y devuelve el texto + las acciones
 * (auto ya ejecutadas / confirma propuestas) que el provider materializa.
 *
 * Contrato de degradación: si no hay claves de API, este módulo NO se llama —
 * el provider cae a su respuesta canned (ver concierge-apis.ts).
 */
import type { ModelMessage } from "ai";
import type {
  ConciergeReplyInput,
  ConciergeProposedAction,
  ProviderInstance,
} from "@clinicos/mocks";
import { emitEvent } from "@clinicos/mocks";
import { resolveAgentModel } from "./model";
import {
  buildClinicFacts,
  buildPromptFromSections,
  localDateBlock,
  runAgentTurn,
} from "./agent-core";
import { recordAgentTrace } from "./agent-trace";
import { buildConciergeTools } from "./concierge-tools";
import {
  screenBurst,
  wrapUserContent,
  INJECTION_PROMPT_RULE,
  NEUTRAL_INJECTION_REPLY,
} from "./input-guard";
import { claimsMutation, mutationClaimGuardEnabled } from "./mutation-claim";
import { transcribeAudio } from "./stt-client";
import { transcribeBuffer } from "./local-stt";
import { retrieveConciergeContext } from "../memory";

/**
 * Transcribe una nota de voz del concierge con el MISMO Whisper local que las
 * consultas (faster-whisper vía uv — sin cold start). Si el STT local no está
 * disponible o falla, cae a la API hospedada (HF/OpenAI) vía transcribeAudio.
 */
async function transcribeVoiceNote(
  buffer: Buffer,
  mime: string
): Promise<string | null> {
  const local = await transcribeBuffer(buffer, mime).catch(() => null);
  if (local) return local;
  const tr = await transcribeAudio(buffer, undefined, mime).catch(() => null);
  return tr?.text?.trim() || null;
}

/** Parte de contenido de un mensaje de usuario multimodal. */
type UserPart = { type: "text"; text: string } | { type: "image"; image: string };

/**
 * Descompone un data URL en su MIME y bytes. El header puede traer parámetros
 * de media-type ANTES de `;base64` — MediaRecorder produce p. ej.
 * `data:audio/webm;codecs=opus;base64,...`. Por eso NO basta con un regex
 * `(;base64)?` pegado al mime: detectamos `;base64` en cualquier parte del
 * header y tomamos el primer token como MIME (igual que `decodeDataUrl` del
 * server).
 */
export function parseDataUrl(
  dataUrl: string
): { mime: string; buffer: Buffer } | null {
  if (!dataUrl.startsWith("data:")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const header = dataUrl.slice(5, comma); // p. ej. "audio/webm;codecs=opus;base64"
  const isB64 = header.includes(";base64");
  const mime = header.split(";")[0] || "application/octet-stream";
  const raw = dataUrl.slice(comma + 1);
  const buffer = isB64
    ? Buffer.from(raw, "base64")
    : Buffer.from(decodeURIComponent(raw), "utf8");
  return { mime, buffer };
}

/**
 * Integra los adjuntos multimodales al último mensaje del usuario:
 *  - audio → STT (se anexa la transcripción al texto);
 *  - imagen → parte de visión que el modelo multimodal "ve";
 *  - documento de texto → inline (acotado); binario → nota honesta.
 * Degradación: si el STT no está disponible, lo dice sin romper el turno.
 */
/**
 * Capa 3 anti-injection: envuelve el TEXTO de los turnos del usuario en
 * <mensaje_usuario> (dato, no instrucción) y lo capa. Las partes de imagen no se
 * tocan. Se aplica en un solo punto, al final de buildTurnMessages, para cubrir
 * tanto el historial como el último turno con adjuntos.
 */
function wrapUserMessage(m: ModelMessage): ModelMessage {
  if (m.role !== "user") return m;
  if (typeof m.content === "string") {
    return { ...m, content: wrapUserContent(m.content) };
  }
  if (Array.isArray(m.content)) {
    const content = m.content.map((part) =>
      part.type === "text" ? { ...part, text: wrapUserContent(part.text) } : part
    );
    return { ...m, content };
  }
  return m;
}

async function buildTurnMessages(
  input: ConciergeReplyInput,
  tz: string
): Promise<ModelMessage[]> {
  const messages = toModelMessages(input.history, tz);
  const attachments = input.attachments ?? [];
  const lastIdx = messages.length - 1;
  const last = lastIdx >= 0 ? messages[lastIdx]! : null;

  if (attachments.length && last && last.role === "user") {
    let text = typeof last.content === "string" ? last.content : input.text;
    const imageParts: UserPart[] = [];

    for (const att of attachments) {
      const isImage = att.kind === "image" || att.mime.startsWith("image/");
      if (att.kind === "audio") {
        const parsed = parseDataUrl(att.dataUrl);
        const transcript = parsed
          ? await transcribeVoiceNote(parsed.buffer, parsed.mime)
          : null;
        text += transcript
          ? `\n\n[Nota de voz transcrita]: ${transcript}`
          : `\n\n[Nota de voz recibida, pero no pude transcribirla.]`;
      } else if (isImage) {
        imageParts.push({ type: "image", image: att.dataUrl });
        text += `\n\n[Imagen adjunta${att.name ? `: ${att.name}` : ""}.]`;
      } else {
        const parsed = parseDataUrl(att.dataUrl);
        const textual =
          att.mime.startsWith("text/") || att.mime === "application/json";
        text +=
          parsed && textual
            ? `\n\n[Archivo adjunto ${att.name ?? ""} (${att.mime})]:\n${parsed.buffer
                .toString("utf8")
                .slice(0, 8000)}`
            : `\n\n[Archivo adjunto: ${att.name ?? "documento"} (${att.mime}). No puedo leer su contenido binario; dime qué necesitas o súbelo como imagen.]`;
      }
    }

    messages[lastIdx] = imageParts.length
      ? { role: "user", content: [{ type: "text", text }, ...imageParts] }
      : { role: "user", content: text };
  }

  // Wrapping anti-injection en un solo punto: cubre historial + último turno.
  return messages.map(wrapUserMessage);
}

/**
 * Voz y reglas del concierge. Calca la intención del concierge de `dental-clinic`:
 * resolutivo, claro, mexicano relajado, ejecuta en el turno, intención ≠ hecho.
 * (Cuando exista un AgentConfig key="concierge" con PromptSections, este default
 * se reemplaza por buildPromptFromSections.)
 */
/**
 * Nombre del concierge (runtime, por-cliente). Default "Sherlock" (becerril);
 * oranza lo cambia con CONCIERGE_NAME=Naird. Es branding, no secreto.
 */
const CONCIERGE_NAME = (process.env.CONCIERGE_NAME || "Sherlock").trim();

const CONCIERGE_SYSTEM = `Eres ${CONCIERGE_NAME}, el concierge del doctor: su mano derecha y su interfaz directa con ClinicOS. Hablas con el doctor o su auxiliar, NUNCA con pacientes. Conoces TODO lo que pasa en la clínica y tu trabajo es que el doctor no tenga que abrir la plataforma: tú se lo traes y se lo ejecutas. Si te preguntan tu nombre, eres ${CONCIERGE_NAME}.

QUÉ VES Y HACES (tu alcance real, úsalo con confianza):
- Panorama general de la clínica → resumen_clinica (cuántos pacientes/leads, citas de hoy, pendientes, escalaciones, sin leer, finanzas).
- Agenda con nombres y horas locales → ver_agenda.
- Cualquier paciente: búscalo (buscar_paciente, también sin texto para listar) y abre su ficha completa con consultar_expediente (citas, pagos, historial). Línea de tiempo de hechos (qué ha pasado, en orden) → ver_historial_eventos.
- Archivos y FOTOS del paciente (lo que mandó por WhatsApp: fotos, notas de voz, estudios, tickets) → ver_archivos_paciente. SÍ puedes MOSTRARLE una imagen al doctor: inclúyela en tu respuesta como ![descripción](asset:<id>). Nunca digas que "no puedes ver imágenes": usa esta herramienta.
- Bandeja de WhatsApp: quién escribió, quién espera, qué está escalado → ver_bandeja. LEER el chat real de un paciente (lo que escribió, no solo metadata) → leer_conversacion. Marcar leída → marcar_conversacion_leida. Asignar un chat a alguien del equipo → asignar_conversacion (usa ver_equipo para los ids). Activar/desactivar modo consultor de ventas → modo_consultor_ventas. Mover un número a blacklist → mover_a_blacklist.
- Equipo de la clínica (ids/roles para asignar) → ver_equipo. Asignar una escalación → asignar_escalacion.
- Citas: confirmar una cita → confirmar_cita. Consultas/copiloto recientes → ver_consultas; resumen del día de un doctor → resumen_del_dia. Auditoría operativa (Kika) → ver_auditoria.
- Bloquear horario SIN paciente (comida, junta, quirófano ocupado, día personal, vacaciones) → bloquear_horario; editarlo (mover hora o cambiar etiqueta) → editar_bloqueo; quitarlo → eliminar_bloqueo. Úsalo cuando el doctor quiera reservar/cerrar un rato que NO es una cita; el bloqueo ocupa el slot para que no se agende nada encima. En ver_agenda los bloqueos salen con 🔒 y esBloqueo:true (no son pacientes).
- Eventos importados de Google Calendar: si en ver_agenda una cita trae porRevisar:true, es un evento que se creó en Google y el sistema no pudo identificar de qué paciente es. Avísale al doctor que hay eventos "por revisar" y ofrécele ligarlos: si reconoces al paciente (búscalo con buscar_paciente), propónselo; el doctor lo confirma o lo ajusta en la agenda.
- Prevaloraciones del paciente → ver_prevaloracion / marcar_prevaloracion_revisada. Datos NO clínicos del expediente (ciudad/campos) → actualizar_expediente. Archivar/restaurar un contacto → archivar_contacto / restaurar_contacto.
- Pagos y finanzas → ver_pagos, ver_finanzas, ver_gastos (listado de gastos). Registrar un GASTO operativo → registrar_gasto (se aplica de inmediato); corregirlo → editar_gasto; borrarlo si fue error → eliminar_gasto. Confirmar un pago pendiente → confirmar_pago. Generar el reporte financiero del mes → generar_reporte_financiero.
- Documentos y archivos del paciente → ver_documentos, crear_cotizacion, crear_receta, aprobar_documento, enviar_documento, ver_archivos_expediente.
- ENTREGA EL PDF EN EL CHAT: cuando generes/apruebes un documento de cualquier tipo (cotización, receta, constancia, …), SIEMPRE dale al usuario el link de descarga del PDF aquí mismo, como enlace markdown: \`📄 [Descargar <folio> (PDF)](pdfUrl)\` (el pdfUrl te lo devuelve aprobar_documento y también ver_documentos). Un borrador no tiene PDF: apruébalo primero. enviar_documento es SOLO para mandárselo al PACIENTE por WhatsApp (requiere que el paciente ya tenga conversación de WhatsApp); si no se puede enviar al paciente, igual entrégale el link al doctor/auxiliar en el chat para que lo comparta él.
- Avisar al personal de la clínica → notificar_equipo. Recordatorios/notas para el doctor → crear_recordatorio.
- Guiar por la app: si preguntan DÓNDE hacer algo ("¿dónde registro un pago?", "guíame para cotizar"), usa guia_app y dales la ruta (ej. /finanzas) y los pasos.
- CRM: crear un contacto nuevo → crear_contacto; actualizar nombre/ciudad/teléfono/email → actualizar_contacto; clasificar un lead → clasificar_lead; moverlo de etapa en el pipeline → mover_etapa_pipeline; volverlo paciente → convertir_a_paciente; revertir un paciente a lead (si fue por error) → revertir_a_lead; resolver una escalación → resolver_escalacion.
- MULTIMODAL: el doctor puede mandarte notas de voz (te llegan ya transcritas en el mensaje), fotos (las ves directo) y archivos. Úsalos como contexto y ACTÚA: una foto de un ticket → registrar_gasto con esos datos; una nota de voz dictando algo → ejecútalo. No describas la imagen por describir; resuelve lo que el doctor quiere de ella.
- Acciones: agendar/reagendar/cancelar citas, responder WhatsApp en nombre del doctor, actualizar/clasificar/convertir contactos, mover etapa de pipeline, registrar gastos, aprobar y enviar documentos, resolver escalaciones, pausar/reanudar al recepcionista en un chat, y proponer cobros.

CÓMO TRABAJAS (esto es lo que te hace útil):
- SÉ INGENIOSO PRIMERO. Cuando te pregunten algo general ("¿cómo va la clínica?", "¿cómo va el CRM?", "¿qué pacientes tengo?", "¿qué hay hoy?"), NO pidas un punto de partida ni te disculpes: LLAMA la herramienta de panorama o lista y responde con datos reales. Tienes con qué.
- ENCADENA herramientas. De una cita sacas el pacienteContactId → consultar_expediente para el detalle. Si te piden "info de los que atendí hoy": ver_agenda → consultar_expediente de cada uno. No digas que no puedes resolver por id: para eso es consultar_expediente.
- Solo declina si DE VERDAD no existe la herramienta — y aun así ofrece la acción más cercana que sí puedes hacer (p. ej. en vez de un recordatorio con hora, déjalo en alertas con crear_recordatorio). Nunca te quedes en "eso está fuera de mi alcance" sin intentar.

VOZ:
- Español mexicano, relajado pero claro. Nunca un bot corporativo, nunca alarmista.
- Di cada idea una sola vez; pasa a la acción o al siguiente paso. Valor por línea.
- Resolutivo: si ya tienes un dato accionable, ACTÚA en este turno y regresa con el resultado, no con "voy a revisar".

REGLAS DURAS:
- ${INJECTION_PROMPT_RULE}
- Las horas y fechas SIEMPRE en hora local de la clínica; usa las que ya vienen formateadas en las herramientas. Nunca inventes la zona horaria ni el offset.
- intención ≠ hecho: un estado solo cambia cuando la herramienta se ejecutó de verdad. No declares hecho lo que no corriste.
- COBRAR a un paciente requiere CONFIRMACIÓN: usa proponer_cobro (deja la acción pendiente para que el doctor la confirme). No afirmes que el cobro ya quedó: queda propuesto. Esto es SOLO para cobros/anticipos; un GASTO operativo (registrar_gasto) es captura contable de un egreso y SÍ se aplica de inmediato.
- Agendar, responder WhatsApp, actualizar/clasificar/convertir contacto, mover etapa de pipeline, registrar gasto, aprobar/enviar documento, resolver escalación, controlar al recepcionista y recordatorios se ejecutan de inmediato.
- Para mensajes a un paciente, transcribe lo que dictó el doctor tal cual; no lo reescribas ni le agregues firma ni emojis.
- "El equipo" SIEMPRE significa el personal de ESTA clínica (doctores, auxiliares). Para avisarles usa notificar_equipo. NUNCA inventes correos, teléfonos ni canales de soporte externos (no existe ningún "soporte@..."); si algo de verdad no se puede, dilo sin inventar un canal.
- Recordatorios con hora futura específica aún no se programan: déjalos en alertas con crear_recordatorio y dilo con honestidad.
- No inventes pacientes ni datos: si no aparece en las herramientas, dilo.`;

function toModelMessages(
  history: ConciergeReplyInput["history"],
  tz: string
): ModelMessage[] {
  const ymd = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
  const dayLabel = (iso: string) =>
    new Intl.DateTimeFormat("es-MX", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date(iso));
  const today = ymd(new Date().toISOString());
  return history.map((m) => {
    // Estampa el día en mensajes de OTRA jornada: las conversaciones del
    // concierge cruzan días, y un viejo "hoy" en el historial contaminaba la
    // fecha actual del agente (decía "martes 23" siendo miércoles 24).
    const stamped =
      m.createdAt && ymd(m.createdAt) !== today
        ? `[mensaje del ${dayLabel(m.createdAt)}] ${m.text}`
        : m.text;
    return {
      role: m.role === "assistant" ? "assistant" : "user",
      content: stamped,
    };
  });
}

// P0 — Guard anti-"claim sin acción": el regex compartido vive en mutation-claim.ts
// (lo comparten recepcionista y pacientes). El concierge conserva su propia voz de
// corrección (GUARD_REPLY, dirigida al staff) más abajo.
const GUARD_REPLY =
  "No pude completar esa acción: no se ejecutó ninguna herramienta de cambio, " +
  "así que no quiero darte por hecho algo que no pasó. ¿Quieres que lo haga ahora? " +
  "Confírmame y lo realizo.";

export async function conciergeReply(
  input: ConciergeReplyInput
): Promise<{ text: string; actions: ConciergeProposedAction[] }> {
  const { provider, db, capabilities } = input;
  const instance: ProviderInstance = { provider, db };

  // Capa 1 anti-injection (simétrica con recepcionista/pacientes): aunque el
  // concierge habla con staff de confianza, screenear el input es defensa en
  // profundidad de costo cero. La inyección INDIRECTA (texto de paciente leído vía
  // tool outputs) NO la cubre esta fase — ver input-guard.ts (TODO fase-2).
  const injected = screenBurst([input.text]);
  if (injected) {
    console.warn(`[concierge] injection bloqueada (${injected}) u=${input.userId}`);
    return { text: NEUTRAL_INJECTION_REPLY, actions: [] };
  }

  const [clinicFacts, settings, agents] = await Promise.all([
    buildClinicFacts(provider),
    provider.settings.get(),
    provider.agents.list(),
  ]);
  const tz = settings.timezone || "America/Mexico_City";

  const sink: ConciergeProposedAction[] = [];
  const shownAssets: { id: string; desc?: string }[] = [];
  const tools = buildConciergeTools({
    instance,
    tz,
    capabilities,
    sink,
    shownAssets,
  });

  // Voz/reglas: si la clínica configuró un AgentConfig key="concierge" con
  // PromptSections, se usan esas (editables por la agencia/cliente); si no, el
  // default embebido. Espeja el patrón modular SOUL/AGENTS del referente.
  const cfg = agents.find((a) => a.key === "concierge" && a.activo);
  const persona =
    cfg && cfg.promptSections.length
      ? buildPromptFromSections(cfg.promptSections).join("\n\n")
      : CONCIERGE_SYSTEM;

  const user = db.state.session?.user;
  const quien = user
    ? `Hablas con ${user.nombre} (rol: ${user.rol}). Capacidades habilitadas: ${capabilities.join(", ")}.`
    : `Capacidades habilitadas: ${capabilities.join(", ")}.`;

  // RAG anti-amnesia: lo que este usuario pidió en threads ya archivados (reset).
  // Best-effort; cadena vacía sin memoria. NO re-muestra el historial archivado.
  const contexto = await retrieveConciergeContext(
    input.clinicId,
    input.userId,
    input.text
  );

  const system = [
    persona,
    "",
    localDateBlock(db.now(), tz),
    "",
    quien,
    ...(contexto ? ["", contexto] : []),
    "",
    clinicFacts,
  ].join("\n");

  const messages = await buildTurnMessages(input, tz);

  const modelLabel =
    process.env.CONCIERGE_MODEL?.trim() ||
    process.env.AGENT_MODEL?.trim() ||
    "claude-sonnet";
  const startedAtMs = Date.now();
  const result = await runAgentTurn({
    // Palanca diferida: CONCIERGE_MODEL le da su propio modelo (más fuerte) sin
    // tocar el AGENT_MODEL de la recepcionista. Sin la env → hereda lo de siempre.
    model: resolveAgentModel("claude-sonnet", process.env.CONCIERGE_MODEL),
    system,
    messages,
    tools,
    // El concierge encadena muchas lecturas por diseño (agenda → expediente de
    // cada paciente, etc.); 10 pasos se quedan cortos en peticiones multi-paso.
    maxSteps: 18,
  });

  // Traza "behind the scenes": qué herramientas llamó el agente este turno.
  const trace = result.toolCalls.map((c) => c.tool).join(" → ") || "(ninguna)";
  console.log(
    `[concierge] u=${input.userId} tools: ${trace}` +
      (sink.length ? ` | acciones: ${sink.map((a) => a.tool).join(", ")}` : "")
  );

  // P0 — ¿el texto afirma una mutación que NINGUNA herramienta ejecutó?
  const claimedMutation = claimsMutation(result.text);
  const guardTriggered =
    mutationClaimGuardEnabled() && claimedMutation && sink.length === 0;

  // P2a — caja negra durable: guarda el turno completo (modelo, tokens, tools con
  // resultado, finishReason) para troubleshooting. Best-effort.
  recordAgentTrace(db, {
    agent: "concierge",
    clinicId: input.clinicId,
    userId: input.userId,
    model: modelLabel,
    startedAtMs,
    result,
    mutations: sink.length,
    claimedMutation,
    guardTriggered,
  });

  // P2b — auditoría durable en el event log: una acción del agente por mutación.
  // refs vacío a propósito (la tool subyacente ya emitió su evento de dominio con
  // sus refs; este NO debe re-disparar proyecciones de profile).
  for (const a of sink) {
    try {
      emitEvent(db, input.clinicId, {
        type: "accion_agente_ejecutada",
        refs: {},
        payload: {
          agent: "concierge",
          userId: input.userId,
          tool: a.tool,
          tier: a.tier,
          summary: a.summary,
          result: a.result,
        },
        actor: db.actor(),
      });
    } catch {
      // best-effort
    }
  }

  // P0 — si el guard disparó, NO le declaramos el hecho al usuario: respuesta de
  // corrección honesta en vez del "✅ hecho" alucinado. (Se registró en la traza.)
  if (guardTriggered) {
    console.warn(
      `[concierge] guard: claim-sin-acción reescrito (u=${input.userId})`
    );
    return { text: GUARD_REPLY, actions: sink };
  }

  // Render determinista de imágenes: si una tool surfó fotos del paciente para
  // mostrar y el modelo no las incrustó como `![](asset:<id>)`, las anexamos
  // nosotros (la UI del concierge resuelve `asset:<id>` → /assets/:id?token=).
  let text = result.text;
  const missing = shownAssets.filter((a) => !text.includes(`asset:${a.id}`));
  if (missing.length > 0) {
    const imgs = missing
      .map((a) => {
        // Sanea el alt: sin corchetes/paréntesis/saltos que rompan el markdown.
        const alt = (a.desc ?? "Foto del paciente")
          .replace(/[[\]()\n\r]/g, " ")
          .trim()
          .slice(0, 120);
        return `![${alt || "Foto del paciente"}](asset:${a.id})`;
      })
      .join("\n");
    text = text.trim() ? `${text}\n\n${imgs}` : imgs;
  }

  return { text, actions: sink };
}

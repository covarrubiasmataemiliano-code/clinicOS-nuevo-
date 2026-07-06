/**
 * Runtime del agente de PACIENTES (cara-a-paciente post-conversión).
 *
 * Espejo del recepcionista pero del lado del paciente: acompaña el JOURNEY
 * clínico (preparacion/cuidado/seguimiento/mantenimiento) de un procedimiento,
 * resuelve dentro de un ALCANCE SEGURO (logística + ficha aprobada por el doctor)
 * y ESCALA al doctor cuando la ocasión lo amerita. Nunca da consejo médico.
 *
 * Reusa el core genérico (`agent-core`) y el toolset de pacientes
 * (`pacientes-tools`). A diferencia del recepcionista, NO corre la extracción
 * de CRM del embudo de leads (este contacto ya es paciente).
 *
 * NOTA: los helpers de formato WhatsApp (turnContent/sanitize/split) se duplican
 * de recepcionista.ts a propósito por ahora; candidatos a extraer a agent-core.
 */
import type {
  ContactContext,
  Message,
  PatientProcedure,
  PatientProfile,
} from "@clinicos/contracts";
import type { ProviderInstance } from "@clinicos/mocks";
import { emitEvent } from "@clinicos/mocks";
import type { AgentReplyResult } from "./recepcionista";
import { buildPacientesTools } from "./pacientes-tools";
import { resolveAgentModel, agentRuntimeAvailable } from "./model";
import {
  screenBurst,
  wrapUserContent,
  INJECTION_PROMPT_RULE,
  NEUTRAL_INJECTION_REPLY,
} from "./input-guard";
import {
  claimsMutation,
  mutationClaimWithoutAction,
  MUTATION_CLAIM_REPLY,
  escalationClaimWithoutAction,
  ESCALATION_CLAIM_REPLY,
  ESCALATION_TOOLS,
} from "./mutation-claim";
import {
  paymentPendingConfirmClaim,
  PAYMENT_PENDING_REPLY,
} from "./payment-claim";
import {
  capabilityEscalationRequired,
  CAPABILITY_GUARD_REPLY,
  CAPABILITY_GUARD_REPLY_UNNOTIFIED,
} from "./capability-guard";
import { runAutoEscalation } from "./auto-escalation";
import { retrieveExamplesBlock } from "../memory";
import { ensureMediaUnderstood } from "../media";
import {
  buildClinicFacts,
  buildPromptFromSections,
  localDateBlock,
  runAgentTurn,
} from "./agent-core";
import { recordAgentTrace } from "./agent-trace";

/** Solo voz: las notas de voz se transcriben siempre (STT barato). */
const AUDIO_ONLY: ReadonlySet<string> = new Set(["audio"]);

/** Tools del agente de pacientes que MUTAN estado (para la traza/auditoría). */
const MUTATION_TOOLS: ReadonlySet<string> = new Set([
  "actualizar_contacto",
  "crear_cita",
  "reagendar_cita",
  "cancelar_cita",
  "confirmar_anticipo",
  "notificar_doctor",
  "escalar_a_humano",
  "escalar_urgente",
  "mover_etapa_procedimiento",
]);

const ETAPA_LABEL: Record<string, string> = {
  preparacion: "preparación",
  cuidado: "cuidado/recuperación",
  seguimiento: "seguimiento",
  mantenimiento: "mantenimiento",
};

function splitIntoBubbles(text: string): string[] {
  const parts = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts.slice(0, 4) : [text];
}

function sanitizeForWhatsApp(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/[¿¡]/g, "")
    .trim();
}

/** Representa un mensaje (incluido multimedia) como texto para el modelo. */
function turnContent(m: Message): string {
  if (m.type === "text") return m.body ?? "";
  if (m.type === "audio") {
    return m.media?.transcript
      ? `(nota de voz transcrita) ${m.media.transcript}`
      : `[el paciente envió una nota de voz. URL: ${m.media?.url ?? "sin url"}]`;
  }
  if (m.type === "image") {
    const cap = m.media?.caption ? ` (con texto: "${m.media.caption}")` : "";
    // El agente de pacientes NO interpreta clínicamente una foto (herida/resultado):
    // la acusa y escala. El doctor la evalúa.
    return `[el paciente envió una imagen${cap}. NO la evalúes clínicamente; acúsala con calidez y escala al doctor (urgente si el texto describe una bandera roja). URL: ${m.media?.url ?? "sin url"}]`;
  }
  if (m.type === "video") {
    return `[el paciente envió un video que no puedes ver. Pídele que te cuente por texto o nota de voz; si parece clínico o urgente, escálalo.]`;
  }
  if (m.type === "document") {
    const fn = m.media?.fileName ?? "";
    return m.media?.transcript
      ? `[el paciente envió un documento ${fn}. Contenido: ${m.media.transcript}]`
      : `[el paciente envió un documento ${fn}. URL: ${m.media?.url ?? "sin url"}]`;
  }
  return m.body ?? `[${m.type}]`;
}

function fmtFechaLocal(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: tz,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

/** Bloque de "panorama capa 2": los procedimientos del paciente con su etapa. */
function buildJourneyBlock(procs: PatientProcedure[]): string {
  const activos = procs.filter((p) => p.status === "activo");
  if (!activos.length) return "";
  const lines = activos.map((p) => {
    const cuando =
      p.diasDesde < 0
        ? `procedimiento en ${-p.diasDesde} día(s)`
        : `hace ${p.diasDesde} día(s)`;
    return `- ${p.nombre} (${p.tipo}) · etapa: ${ETAPA_LABEL[p.etapa] ?? p.etapa} · ${cuando}`;
  });
  return `## Procedimientos del paciente (su journey clínico — usa enviar_ficha para el detalle aprobado)
${lines.join("\n")}`;
}

/** Expediente vivo del contacto para el prompt (scoped al contacto). */
function buildContactDossier(
  context: ContactContext,
  profile: PatientProfile | null,
  nowIso: string,
  tz: string
): string {
  const { contact, record, appointments } = context;
  const now = Date.parse(nowIso);
  const lines: string[] = [];

  if (profile?.resumen) lines.push(profile.resumen);
  for (const s of profile?.signals ?? []) {
    if (s.severity !== "info") lines.push(`⚠ ${s.message}`);
  }

  const futura = appointments
    .filter((a) => a.estado !== "cancelada" && Date.parse(a.startsAt) >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (futura) {
    lines.push(
      `Próxima cita: ${fmtFechaLocal(futura.startsAt, tz)} — ${futura.motivo} (estado: ${futura.estado}; anticipo: ${futura.depositStatus}).`
    );
  }

  const pasadas = appointments
    .filter((a) => Date.parse(a.startsAt) < now)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, 2);
  if (pasadas.length) {
    lines.push(
      "Historial de citas: " +
        pasadas
          .map((a) => `${fmtFechaLocal(a.startsAt, tz)} ${a.motivo} (${a.estado})`)
          .join("; ") +
        "."
    );
  }

  const ant = record?.antecedentes;
  if (ant) {
    const parts: string[] = [];
    if (ant.alergias) parts.push(`alergias: ${ant.alergias}`);
    if (ant.enfermedades) parts.push(`enfermedades: ${ant.enfermedades}`);
    if (ant.medicamentos) parts.push(`medicamentos: ${ant.medicamentos}`);
    if (ant.quirurgicos) parts.push(`cirugías previas: ${ant.quirurgicos}`);
    if (parts.length) lines.push(`Antecedentes — ${parts.join("; ")}.`);
  }

  if (!lines.length) lines.push("Sin historial registrado todavía.");

  return `## Expediente vivo del contacto (SOLO de él — jamás mezcles datos de otras personas)
Nombre: ${contact.nombre ?? "desconocido"} · Tipo: ${contact.tipo} · Ciudad: ${contact.ciudad ?? "?"}
Teléfono: ${contact.whatsappPhone}
${lines.join("\n")}`;
}

/**
 * Genera y persiste la respuesta del agente de pacientes para una conversación.
 * No verifica iaState — eso lo decide el caller (el router/webhook en Etapa 2).
 */
export async function runPacientes(
  instance: ProviderInstance,
  conversationId: string
): Promise<AgentReplyResult> {
  if (process.env.PACIENTES_AGENT_ENABLED === "false") {
    return {
      ok: false,
      error: "El agente de pacientes está deshabilitado (PACIENTES_AGENT_ENABLED=false).",
    };
  }
  if (!agentRuntimeAvailable()) {
    return {
      ok: false,
      error: "Sin proveedor de IA configurado. El runtime de agentes está apagado.",
    };
  }

  const { provider, db } = instance;

  // 1. Conversación + contacto (la identidad que limita TODO el contexto).
  const conversation = await provider.conversations.get(conversationId);
  const context = await provider.contacts.getContext(conversation.contactId);
  const contact = context.contact;

  // Profile 360 del paciente (get-or-reproject) + journey (capa 2 del panorama).
  const profileRaw =
    (await provider.profiles.get("patient", contact.id).catch(() => null)) ??
    (await provider.profiles.reproject("patient", contact.id).catch(() => null));
  const profile = profileRaw?.entityType === "patient" ? profileRaw : null;
  const procedures = await provider.patientProcedures
    .listForContact(contact.id)
    .catch(() => [] as PatientProcedure[]);

  // 2. AgentConfig de pacientes → prompt maestro desde sus secciones vivas.
  const agents = await provider.agents.list();
  const config = agents.find((a) => a.key === "pacientes" && a.activo);
  if (!config) {
    return { ok: false, error: "La clínica no tiene un agente de pacientes activo." };
  }

  const settings = await provider.settings.get().catch(() => null);
  const tz = settings?.timezone || "America/Mexico_City";
  const clinicFacts = await buildClinicFacts(provider);
  const dossier = buildContactDossier(context, profile, db.now(), tz);
  const journeyBlock = buildJourneyBlock(procedures);
  const nameOverride = process.env.PACIENTES_AGENT_NAME?.trim();

  const examplesBlock = await retrieveExamplesBlock(instance.db, conversationId, {
    contactId: contact.id,
  }).catch(() => "");

  const system = [
    ...buildPromptFromSections(config.promptSections),
    clinicFacts,
    `${dossier}
${journeyBlock ? journeyBlock + "\n" : ""}${localDateBlock(db.now(), tz)}`,
    `## Reglas de ejecución (innegociables)
- ${INJECTION_PROMPT_RULE}
- Responde SIEMPRE en español mexicano, cálido y contenedor, como una persona real del consultorio. Nunca digas que eres una IA.${nameOverride ? ` Te llamas ${nameOverride}.` : ""}
- Formato WhatsApp: TEXTO PLANO, sin Markdown (no **negritas**, ## títulos ni viñetas). Escribe en 1 a 3 mensajes CORTOS separados por UNA línea en blanco; no partas una idea a la mitad.
- Puntuación: SOLO signos de cierre ("?" y "!"); nunca "¿" ni "¡". Sin emojis. Máximo una pregunta por mensaje.
- Ejecuta las herramientas en silencio y entrega tu respuesta al final. Nunca narres pasos ("voy a revisar…").`,
    `## Tu alcance clínico (LÍMITE DURO — innegociable)
Acompañas al paciente DESPUÉS de su conversión. NO eres el doctor y NUNCA das consejo médico.
PUEDES:
- Relayar la ficha de cuidado APROBADA por el doctor — usa enviar_ficha: lo normal por etapa, cuidados, preparación.
- Resolver logística: fechas, agendar/reagendar seguimiento (crear_cita/reagendar_cita), qué llevar, ubicación, costos ya cotizados.
- Recopilar y triar: pregunta lo necesario (desde cuándo, intensidad) para condensar el caso al doctor.
NUNCA:
- Diagnosticar, recomendar o cambiar tratamiento/medicamento, interpretar una foto de herida/resultado, ni dar pronóstico.
REGLA DE GROUNDING (la más importante): toda afirmación clínica debe venir de enviar_ficha o del expediente (consultar_expediente). Si NO está ahí, NO la afirmes: escala. Decir "es normal" SOLO es válido si aparece en 'normalesEnEstaEtapa' de la ficha para esa etapa; si el síntoma no está listado, coincide con una bandera roja, o dudas → escala. Atribuye siempre al doctor ("según tu plan de cuidado…").`,
    `## Cuándo y cómo escalar al doctor
- Bandera roja (sangrado abundante, fiebre, dolor súbito intenso, signos de infección, reacción adversa) o emergencia → escalar_urgente. Dile al paciente, con calma, que ya avisaste al doctor y que si es una emergencia acuda a urgencias.
- Duda clínica legítima fuera de tu alcance, sin alarma → notificar_doctor (paciente_escribe); dile que lo estás consultando con el doctor y le confirmas en cuanto te responda.
- FOTO de herida/resultado: NO la evalúes. Acúsala con calidez y escala (urgente si el texto describe una bandera roja; si no, notificar_doctor). El doctor la revisa.
- Honestidad: solo dile "ya avisé al doctor" DESPUÉS de que la herramienta lo confirme. Ante la duda, escala.`,
    examplesBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  // 3. Historial → turnos del LLM (multimedia como texto).
  const history = await provider.messages.list(conversationId);
  const recent = history.slice(-20);
  await ensureMediaUnderstood(instance.db, recent, AUDIO_ONLY).catch(() => {});
  // Capa 3 anti-injection: el texto del paciente va envuelto en <mensaje_usuario>
  // (dato, no instrucción) y capado; los turnos del agente (assistant) no se tocan.
  const turns = history.slice(-20).map((m) => ({
    role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
    content: m.direction === "in" ? wrapUserContent(turnContent(m)) : turnContent(m),
  }));

  // Persiste una respuesta (1–4 burbujas) + evento SSE y actualiza la conversación.
  // Compartido por el flujo normal y el early-return anti-injection.
  const persistReplies = (text: string): Message[] => {
    const bubbles = splitIntoBubbles(text);
    const out: Message[] = [];
    let last = "";
    for (const body of bubbles) {
      const reply: Message = {
        id: db.nextId("msg"),
        conversationId,
        direction: "out",
        authorType: "ia",
        type: "text",
        body,
        status: "enviado",
        sentAt: db.now(),
      };
      db.state.messages.push(reply);
      db.emit("message", reply);
      out.push(reply);
      last = body;
    }
    conversation.lastMessagePreview = last.slice(0, 80);
    conversation.lastMessageAt = db.now();
    db.persist();
    return out;
  };

  // Capa 1 anti-injection: si la ráfaga entrante (mensajes `in` desde la última
  // salida) trae un jailbreak conocido, respondemos neutro SIN llamar al LLM ni a
  // las tools. Costo cero y sin superficie de ataque.
  const burst: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.direction === "in") burst.unshift(turnContent(history[i]!));
    else break;
  }
  const injected = screenBurst(burst);
  if (injected) {
    console.warn(
      `[pacientes] injection bloqueada (${injected}) conv=${conversationId}`
    );
    return { ok: true, replies: persistReplies(NEUTRAL_INJECTION_REPLY), toolCalls: [] };
  }

  // 4. Loop de tool-use delegado al core genérico.
  const startedAtMs = Date.now();
  const result = await runAgentTurn({
    model: resolveAgentModel(config.modelo),
    system,
    messages: turns,
    tools: buildPacientesTools({
      instance,
      conversationId,
      contactId: contact.id,
      enabledTools: config.enabledTools,
    }),
  });
  const { text: rawText, toolCalls } = result;

  const modelLabel = process.env.AGENT_MODEL?.trim() || config.modelo;
  const mutatingCalls = result.toolCalls.filter(
    (c) => MUTATION_TOOLS.has(c.tool) && c.ok !== false
  );

  // P0 — Guard anti claim-sin-acción (compartido, vía mutation-claim.ts): si la
  // respuesta AFIRMA una mutación pero ninguna tool de cambio corrió, corregimos.
  const claimedMutation = claimsMutation(rawText);
  const mutationGuard = mutationClaimWithoutAction(rawText, mutatingCalls.length);
  // P0 — Honestidad de ESCALACIÓN: con pacientes es lo más sensible (síntoma →
  // "ya avisé al doctor" sin escalar = falsa tranquilidad clínica). Mismo patrón.
  const escalatedThisTurn = result.toolCalls.some(
    (c) => ESCALATION_TOOLS.has(c.tool) && c.ok !== false
  );
  const escalationGuard = escalationClaimWithoutAction(rawText, escalatedThisTurn);
  // P0 — Honestidad de PAGO EN REVISIÓN (Capa 5): mismo guard que recepcionista
  // (confirmar_anticipo también vive en el toolset contact-scoped de pacientes).
  const paymentGuard = paymentPendingConfirmClaim(rawText, result.toolCalls);
  // P0 — Guard de CAPACIDADES (Capa 9): mismo patrón que recepcionista. Solo
  // mensajes de TEXTO (captions/filenames de media no disparan el guard).
  const capabilityBurst: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.direction !== "in") break;
    if (m.type === "text" && m.body) capabilityBurst.unshift(m.body);
  }
  const capabilityTopic = capabilityEscalationRequired(
    capabilityBurst,
    escalatedThisTurn
  );
  const capabilityGuard = capabilityTopic !== null;
  const guardTriggered =
    mutationGuard || escalationGuard || paymentGuard || capabilityGuard;

  recordAgentTrace(db, {
    agent: "pacientes",
    clinicId: contact.clinicId,
    conversationId,
    model: modelLabel,
    startedAtMs,
    result,
    mutations: mutatingCalls.length,
    claimedMutation,
    guardTriggered,
  });

  const toolTrace = result.toolCalls.map((c) => c.tool).join(" → ") || "(ninguna)";
  console.log(
    `[pacientes] conv=${conversationId} tools: ${toolTrace}` +
      (mutatingCalls.length
        ? ` | acciones: ${mutatingCalls.map((c) => c.tool).join(", ")}`
        : "")
  );

  for (const c of mutatingCalls) {
    try {
      emitEvent(db, contact.clinicId, {
        type: "accion_agente_ejecutada",
        refs: {},
        payload: {
          agent: "pacientes",
          conversationId,
          contactId: contact.id,
          tool: c.tool,
          args: c.input,
        },
        actor: db.actor(),
      });
    } catch {
      /* observabilidad best-effort */
    }
  }

  if (escalationGuard) {
    console.warn(
      `[pacientes] guard: claim-escalación-sin-acción reescrito (conv=${conversationId})`
    );
  } else if (paymentGuard) {
    console.warn(
      `[pacientes] guard: claim-cita-confirmada-con-pago-en-revisión reescrito (conv=${conversationId})`
    );
  } else if (capabilityGuard) {
    console.warn(
      `[pacientes] guard: tema-fuera-de-alcance (${capabilityTopic!.label}) reescrito (conv=${conversationId})`
    );
  } else if (mutationGuard) {
    console.warn(
      `[pacientes] guard: claim-sin-acción reescrito (conv=${conversationId})`
    );
  }
  // Notificación DESACOPLADA de qué guard gana el texto (mismo criterio que
  // recepcionista): el equipo siempre se entera del tema fuera de alcance.
  // El éxito decide el copy: "ya les pasé tu solicitud" SOLO si la
  // notificación existe; si falló, el copy no afirma ninguna acción.
  let capabilityNotified = false;
  if (capabilityTopic) {
    try {
      await provider.notifications.create({
        tipo: capabilityTopic.tipo,
        title: "Solicitud fuera de alcance de la IA",
        body: `[guard] El contacto pidió: ${capabilityTopic.label}. Dar seguimiento humano.`,
        contactId: contact.id,
        conversationId,
      });
      capabilityNotified = true;
    } catch {
      console.warn(
        `[pacientes] guard: notificación de tema-fuera-de-alcance FALLÓ (conv=${conversationId}) — copy sin afirmación de aviso`
      );
    }
  }
  const text = escalationGuard
    ? ESCALATION_CLAIM_REPLY
    : paymentGuard
      ? PAYMENT_PENDING_REPLY
      : capabilityGuard
        ? capabilityNotified
          ? CAPABILITY_GUARD_REPLY
          : CAPABILITY_GUARD_REPLY_UNNOTIFIED
        : mutationGuard
          ? MUTATION_CLAIM_REPLY
          : sanitizeForWhatsApp(rawText);

  // 5. Burbujas + persistir cada una + evento SSE.
  const replies = persistReplies(text);

  // Pieza 4 — Red de seguridad de AUTO-ESCALACIÓN (post-turno, en background, sin
  // demorar la respuesta): si el paciente describió una bandera roja y el agente
  // NO escaló este turno, un extractor acotado lo detecta y avisa/escala al
  // equipo. Opt-in (AUTO_ESCALATION=on) y gateado por pre-filtro de síntomas.
  void runAutoEscalation(instance, conversationId, config.modelo, {
    escalatedThisTurn,
    burst,
  }).catch(() => {});

  return { ok: true, replies, toolCalls };
}

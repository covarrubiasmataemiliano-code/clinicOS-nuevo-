/**
 * Runtime del agente recepcionista.
 *
 * Flujo: mensaje entrante → contexto del contacto (SOLO el suyo) → prompt
 * maestro = PromptSections del AgentConfig + DATOS VIVOS de la clínica (sedes,
 * horarios, anticipos, catálogo, leídos de la BD en cada turno) + contexto del
 * contacto → loop de tool-use → respuesta escrita en la conversación.
 *
 * Diferencias clave vs OpenClaw/Coco:
 *  - Tools = funciones TS directas (sin sandbox que se rompa).
 *  - Datos duros vienen de la BD tipada (precios/horarios/anticipos siempre
 *    frescos, editables en Configuración) — el modelo no los inventa.
 *  - Multimedia: imágenes/PDF se pasan por URL a las tools de visión; el audio
 *    usa su transcripción si está disponible.
 *
 * Capa de modelo: Vercel AI SDK (agnóstica). `modelo` del AgentConfig se mapea
 * a un id real; AGENT_MODEL del entorno lo sobreescribe. Default OpenRouter +
 * DeepSeek V4 (económico).
 */
import { generateObject } from "ai";
import { z } from "zod";
import type { Message, ContactContext, PatientProfile } from "@clinicos/contracts";
import type { ProviderInstance } from "@clinicos/mocks";
import { emitEvent } from "@clinicos/mocks";
import { buildRecepcionistaTools } from "./tools";
import { resolveAgentModelChain, agentRuntimeAvailable } from "./model";
import { withModelFallback } from "./model-fallback";
import { canAdvanceClassification } from "./funnel";
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
import { retrieveExamplesBlock } from "../memory";
import { ensureMediaUnderstood } from "../media";
import {
  buildClinicFacts,
  buildPromptFromSections,
  localDateBlock,
  runAgentTurn,
} from "./agent-core";
import { recordAgentTrace } from "./agent-trace";

export { agentRuntimeAvailable };

export interface AgentReplyResult {
  ok: boolean;
  /** Respuesta dividida en burbujas (como escribe un humano por WhatsApp). */
  replies?: Message[];
  toolCalls?: { tool: string; input: unknown }[];
  error?: string;
}

/**
 * Divide la respuesta en burbujas cortas (1–4) como mandaría una persona por
 * WhatsApp, partiendo por líneas en blanco. Si el modelo devolvió un bloque
 * largo sin separar, lo deja como una sola burbuja (no parte frases a la mitad).
 * (Exportada solo para tests — Capa 10; el flujo entra por runRecepcionista.)
 */
export function splitIntoBubbles(text: string): string[] {
  const parts = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts.slice(0, 4) : [text];
}

/**
 * Limpia la respuesta para WhatsApp: quita Markdown (que se ve literal) y los
 * signos de apertura ¿/¡ (el estilo de la recepcionista usa solo signos de
 * cierre). Garantiza el formato aunque el modelo no obedezca el prompt.
 * (Exportada solo para tests — Capa 10; el flujo entra por runRecepcionista.)
 */
export function sanitizeForWhatsApp(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1") // **negritas** → texto
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "") // ## títulos
    .replace(/^\s*[-*]\s+/gm, "• ") // viñetas -/* → •
    .replace(/[¿¡]/g, "") // solo signos de cierre
    .trim();
}

/** Solo voz: notas de voz se transcriben siempre (STT barato), sin gatillar visión. */
const AUDIO_ONLY: ReadonlySet<string> = new Set(["audio"]);

/**
 * Tools de la recepcionista que MUTAN estado (vs lecturas tipo consultar_*). Se
 * usan para contar mutaciones reales en la traza y emitir `accion_agente_ejecutada`
 * (auditoría durable), igual que el sink del concierge. Mantener en sync con tools.ts.
 */
const MUTATION_TOOLS: ReadonlySet<string> = new Set([
  "actualizar_contacto",
  "clasificar_lead",
  "enviar_datos_anticipo",
  "crear_cita",
  "confirmar_anticipo",
  "reagendar_cita",
  "cancelar_cita",
  "prevaloracion_por_fotos",
  "registrar_referido",
  "notificar_doctor",
  "escalar_a_humano",
  "mover_a_blacklist",
]);

/** Representa un mensaje (incluido multimedia) como texto para el modelo. */
export function turnContent(m: Message): string {
  if (m.type === "text") return m.body ?? "";
  if (m.type === "audio") {
    return m.media?.transcript
      ? `(nota de voz transcrita) ${m.media.transcript}`
      : `[el paciente envió una nota de voz. URL: ${m.media?.url ?? "sin url"}]`;
  }
  if (m.type === "image") {
    const cap = m.media?.caption ? ` (con texto: "${m.media.caption}")` : "";
    // Sin transcript (FEATURE_MEDIA_UNDERSTANDING apagado) la imagen NO es un
    // adjunto opaco: el modelo recibe instrucción de qué hacer con ella para que
    // el paciente nunca sienta que su foto fue ignorada. La URL se conserva
    // porque es lo que confirmar_anticipo / prevaloracion_por_fotos reciben.
    return m.media?.transcript
      ? `[el paciente envió una imagen${cap}. Contenido: ${m.media.transcript}]`
      : `[el paciente envió una imagen${cap} que NO puedes ver. NUNCA digas que ya la revisaste. Si por el contexto es un comprobante de pago, usa confirmar_anticipo con esta URL: ${m.media?.url ?? "sin url"}; si son fotos para valoración, usa prevaloracion_por_fotos con esa URL. Si no sabes qué es, agradécele la imagen y pídele con calidez que te cuente en texto qué muestra.]`;
  }
  if (m.type === "video") {
    return m.media?.transcript
      ? `[el paciente envió un video. Contenido: ${m.media.transcript}]`
      : `[el paciente envió un video que NO puedo ver automáticamente. Pídele con amabilidad que te cuente por texto o por nota de voz qué muestra; si parece algo clínico o urgente, escálalo al equipo.]`;
  }
  if (m.type === "document") {
    const fn = m.media?.fileName ?? "";
    return m.media?.transcript
      ? `[el paciente envió un documento ${fn}. Contenido: ${m.media.transcript}]`
      : `[el paciente envió un documento ${fn}. URL: ${m.media?.url ?? "sin url"}]`;
  }
  return m.body ?? `[${m.type}]`;
}

/** Fecha-hora local legible (es-MX) para el contexto del agente. */
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

/**
 * Expediente VIVO del contacto para el prompt: resumen 360 (del patient_profile)
 * + señales accionables (anticipo vencido, no-show repetido…) + próxima cita +
 * historial + antecedentes. Reemplaza los conteos pelones para que el agente
 * CONOZCA al paciente y no se vea amnésico. Todo scoped al contacto.
 */
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

  // Señales accionables primero (urgent/warn); las "info" se omiten por ruido.
  for (const s of profile?.signals ?? []) {
    if (s.severity !== "info") lines.push(`⚠ ${s.message}`);
  }

  // Próxima cita futura (no cancelada) — para no duplicar ni dar por hecho.
  const futura = appointments
    .filter((a) => a.estado !== "cancelada" && Date.parse(a.startsAt) >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (futura) {
    lines.push(
      `Próxima cita: ${fmtFechaLocal(futura.startsAt, tz)} — ${futura.motivo} (estado: ${futura.estado}; anticipo: ${futura.depositStatus}).`
    );
  }

  // Últimas 2 citas pasadas (contexto histórico).
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

  // Antecedentes médicos (seguridad: alergias/enfermedades/medicamentos).
  const ant = record?.antecedentes;
  if (ant) {
    const parts: string[] = [];
    if (ant.alergias) parts.push(`alergias: ${ant.alergias}`);
    if (ant.enfermedades) parts.push(`enfermedades: ${ant.enfermedades}`);
    if (ant.medicamentos) parts.push(`medicamentos: ${ant.medicamentos}`);
    if (ant.quirurgicos) parts.push(`cirugías previas: ${ant.quirurgicos}`);
    if (parts.length) lines.push(`Antecedentes — ${parts.join("; ")}.`);
  }

  // Procedimientos de interés (del profile).
  const procs = profile?.estado.procedimientosDeInteres ?? [];
  if (procs.length) lines.push(`Procedimientos de interés: ${procs.join(", ")}.`);

  if (!lines.length) {
    lines.push("Sin historial registrado todavía (contacto nuevo).");
  }

  return `## Expediente vivo del contacto (SOLO de él — jamás mezcles datos de otras personas)
Nombre: ${contact.nombre ?? "desconocido"} · Tipo: ${contact.tipo} · Ciudad: ${contact.ciudad ?? "?"}
Clasificación: ${contact.leadClassification?.value ?? "sin clasificar"} · Teléfono: ${contact.whatsappPhone}
${lines.join("\n")}`;
}

/**
 * Genera y persiste la respuesta del agente para una conversación.
 * No verifica iaState — eso lo decide el caller (el webhook respeta la máquina
 * de estados; /agent/test permite probar siempre).
 */
export async function runRecepcionista(
  instance: ProviderInstance,
  conversationId: string
): Promise<AgentReplyResult> {
  if (!agentRuntimeAvailable()) {
    return {
      ok: false,
      error:
        "Sin proveedor de IA configurado (OPENROUTER_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY). El runtime de agentes está apagado.",
    };
  }

  const { provider, db } = instance;

  // 1. Conversación + contacto (la identidad que limita TODO el contexto).
  const conversation = await provider.conversations.get(conversationId);
  const context = await provider.contacts.getContext(conversation.contactId);
  const contact = context.contact;

  // Profile 360 del paciente (proyección del agentic-ERP): expediente vivo +
  // señales para que el agente no se vea amnésico con un contacto conocido.
  // get-or-reproject: si no hay profile (contacto previo sin eventos), se
  // construye del estado actual al vuelo.
  const profileRaw =
    (await provider.profiles.get("patient", contact.id).catch(() => null)) ??
    (await provider.profiles.reproject("patient", contact.id).catch(() => null));
  const profile = profileRaw?.entityType === "patient" ? profileRaw : null;

  // 2. AgentConfig de la clínica → prompt maestro desde sus secciones vivas.
  const agents = await provider.agents.list();
  const config = agents.find((a) => a.key === "recepcionista" && a.activo);
  if (!config) {
    return { ok: false, error: "La clínica no tiene un agente recepcionista activo." };
  }

  const settings = await provider.settings.get().catch(() => null);
  const tz = settings?.timezone || "America/Mexico_City";
  const clinicFacts = await buildClinicFacts(provider);

  const dossier = buildContactDossier(context, profile, db.now(), tz);
  // Log diagnóstico (sin PHI: solo id + conteos). Gated, default ON; apaga con
  // DOSSIER_DEBUG=false. Confirma que el expediente se está inyectando al prompt.
  if (process.env.DOSSIER_DEBUG !== "false") {
    const sigCount = (profile?.signals ?? []).filter(
      (s) => s.severity !== "info"
    ).length;
    console.info(
      `[dossier] contacto=${contact.id} profile=${profile ? "sí" : "reproject"} chars=${dossier.length} señales=${sigCount}`
    );
  }

  // Recuperación: ejemplos pasados parecidos a la situación actual (aprendizaje).
  // Cadena vacía si no hay memoria/ejemplos → no afecta el prompt.
  const examplesBlock = await retrieveExamplesBlock(instance.db, conversationId, {
    contactId: contact.id,
  }).catch(() => "");

  const system = [
    ...buildPromptFromSections(config.promptSections),
    clinicFacts,
    `${dossier}
${localDateBlock(db.now(), tz)}`,
    `## Reglas de ejecución (innegociables)
- ${INJECTION_PROMPT_RULE}
- Responde SIEMPRE en español mexicano, cálido y natural, como una persona real del consultorio. Nunca digas que eres una IA.
- Formato WhatsApp: escribe en TEXTO PLANO. Nada de Markdown: no uses **negritas**, ## títulos, ni viñetas. Si quieres enfatizar un dato, escríbelo normal o entre *un solo asterisco*.
- Escribe como en WhatsApp: en 1 a 3 mensajes CORTOS, no un párrafo largo. Separa cada mensaje (burbuja) con UNA línea en blanco. No partas una idea a la mitad.
- Puntuación: usa SOLO signos de cierre ("?" y "!"). NUNCA escribas "¿" ni "¡" al inicio de una pregunta o exclamación.
- Máximo una pregunta por mensaje. Sin emojis. Sin frases vacías ("perfecto", "genial").
- NUNCA uses la palabra "sistema". Si necesitas pedir un dato di "para buscarte en nuestros registros" o simplemente pregunta sin explicar.
- Pide el nombre del lead como máximo 2 veces por conversación. Si no lo dio tras 2 intentos, continúa ayudándolo sin volver a pedirlo.
- Ejecuta las herramientas en silencio y entrega tu respuesta al final. Nunca narres pasos ("voy a revisar…").
- Ante cualquier pregunta sobre tratamientos, precios o servicios: llama SIEMPRE consultar_catalogo antes de responder. Nunca cites precios ni servicios de memoria.
- Usa solo datos confirmados por las herramientas o los DATOS VIVOS. No inventes precios, horarios, links ni datos bancarios.
- EN CUANTO el lead te diga su nombre, llama actualizar_contacto con ese nombre en el MISMO turno (no esperes al cierre). Es lo más importante para no perder el contacto.
- Al cierre del turno SIEMPRE actualiza el CRM: si el lead mostró intención o cambió de etapa, llama clasificar_lead; si aprendiste un dato nuevo (ciudad, procedimiento), llama actualizar_contacto. No dejes el CRM atrás de la conversación.
- Cuando el lead confirme un horario específico (ej. "el martes a las 6", "ese día me queda bien"): llama crear_cita en ESE MISMO turno para apartar el lugar, ANTES de compartir datos bancarios.
- Si el lead dice que ya mandó o ya envió el comprobante: llama confirmar_anticipo con la URL de la imagen más reciente. NUNCA llames crear_cita si el lead ya tiene una cita pendiente de anticipo.
- Si el paciente envía un comprobante (imagen) para una cita pendiente: usa confirmar_anticipo con esa URL. Si manda fotos para prevaloración, usa prevaloracion_por_fotos.
- CITAS CON ANTICIPO: una cita NO está agendada ni confirmada hasta que EL EQUIPO de la clínica confirme el anticipo en el panel. TÚ NUNCA confirmas pagos ni citas: confirmar_anticipo solo PREVALIDA el comprobante y lo deja EN REVISIÓN del equipo — aunque devuelva ok:true, la cita SIGUE sin confirmarse. NUNCA digas "tu cita quedó agendada/confirmada/lista" ni "tu pago quedó registrado/confirmado". Cuando confirmar_anticipo salga ok, di: "Recibí tu comprobante y quedó en revisión del equipo. Te avisamos por aquí en cuanto quede confirmado." Antes del comprobante, di que le APARTAS el lugar.
- NO DUPLIQUES CITAS: si el contacto ya tiene una cita, NO crees otra para cambiar la hora — vuelve a llamar crear_cita (que reagenda la existente sola). Antes de agendar, considera lo que ya tiene en su expediente; el que te escribe ES el dueño de esa cita.
- Si confirmar_anticipo dice que el comprobante no se ve claro, pide UNA foto más clara y NO confirmes; no inventes que ya quedó pagada.`,
    `## Cuándo avisar o escalar al equipo (tu territorio)
Tú orientas, agendas y resuelves dudas con tus herramientas y los DATOS VIVOS. Cuando algo se sale de eso, avisa a una persona — nunca lo dejes pasar ni adivines.
- Regla de oro: ANTE LA DUDA, NOTIFICA. Si dudas de si un mensaje necesita el criterio del doctor, avisa. La duda se resuelve a favor de avisar, nunca en contra.
- Regla de desconocimiento: si la respuesta NO está en tus herramientas ni en los DATOS VIVOS (precio no listado, política que no conoces, caso médico), NO la inventes — escala.
- Distingue lead de paciente: un PACIENTE (ya viene/vino a consulta) que escribe con una duda médica de su caso (dosis, dolor, post-operatorio, síntoma, recuperación) es PRIORIDAD: usa notificar_doctor (paciente_escribe). Un LEAD que pide hablar con el doctor → escalar_a_humano (lead_pide_doctor); algo fuera de tu alcance → escalar_a_humano (lead_fuera_alcance).
- Qué herramienta usar:
  · notificar_doctor: deja un aviso al equipo pero TÚ sigues atendiendo la conversación (p. ej. un paciente con una duda médica que el doctor debe ver).
  · escalar_a_humano: pasa la conversación a una persona y deja de responder (piden al doctor, algo fuera de tu alcance, una queja).
  · escalar_urgente: SOLO para casos sensibles que NO pueden esperar — tema quirúrgico o post-operatorio, un problema de pago/comprobante que no puedes resolver, o una queja seria. Avisa con prioridad y despídete diciendo que una persona del equipo continúa enseguida.
- Honestidad: solo dile al paciente "ya le avisé al doctor / en un momento te atienden" DESPUÉS de que la herramienta confirme que se registró. Si falló, di que en breve lo atienden y reintenta — nunca prometas algo que no pasó.`,
    examplesBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  // 3. Historial de la conversación → turnos del LLM (incluye multimedia como texto).
  const history = await provider.messages.list(conversationId);
  // Entiende media reciente → media.transcript, que turnContent inyecta como texto.
  // VOZ: SIEMPRE se transcribe (STT local/Whisper, gratis o centavos) — las notas de
  // voz son atención básica, igual que el concierge; no se esconden tras un flag.
  const recent = history.slice(-20);
  await ensureMediaUnderstood(instance.db, recent, AUDIO_ONLY).catch(() => {});
  // IMAGEN/VIDEO/DOC: visión cuesta → flag por-cliente (default OFF = becerril;
  // oranza lo enciende con FEATURE_MEDIA_UNDERSTANDING=true). Best-effort.
  if (process.env.FEATURE_MEDIA_UNDERSTANDING === "true") {
    await ensureMediaUnderstood(instance.db, recent).catch(() => {});
  }
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
  // las tools ni al extractor de CRM. Costo cero y sin superficie de ataque.
  const burst: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.direction === "in") burst.unshift(turnContent(history[i]!));
    else break;
  }
  const injected = screenBurst(burst);
  if (injected) {
    console.warn(
      `[recepcionista] injection bloqueada (${injected}) conv=${conversationId}`
    );
    return { ok: true, replies: persistReplies(NEUTRAL_INJECTION_REPLY), toolCalls: [] };
  }

  // 4. Loop de tool-use delegado al core genérico.
  const startedAtMs = Date.now();
  const modelChain = resolveAgentModelChain(config.modelo);
  const result = await runAgentTurn({
    model: modelChain[0]!,
    fallbackModels: modelChain.slice(1),
    system,
    messages: turns,
    tools: buildRecepcionistaTools({
      instance,
      conversationId,
      contactId: contact.id,
      enabledTools: config.enabledTools,
    }),
  });
  const { text: rawText, toolCalls } = result;

  // Modelo REALMENTE ejecutado: AGENT_MODEL pisa config.modelo en resolveAgentModel,
  // así que la traza debe reflejar el override (si no, miente "claude-sonnet" cuando
  // en prod corre qwen). Espeja el modelLabel del concierge.
  const modelLabel = process.env.AGENT_MODEL?.trim() || config.modelo;

  // Mutaciones reales del turno: tool calls que cambiaron estado y no fallaron
  // (equivalente al `sink` del concierge, que la recepcionista no tiene porque sus
  // tools ejecutan directo).
  const mutatingCalls = result.toolCalls.filter(
    (c) => MUTATION_TOOLS.has(c.tool) && c.ok !== false
  );

  // P0 — Guard anti claim-sin-acción (portado del concierge, vía mutation-claim.ts):
  // si la respuesta AFIRMA una mutación ("ya quedó agendada", "cancelé tu cita")
  // pero NINGUNA tool de cambio corrió este turno, no le declaramos el hecho al
  // paciente: corrección honesta en vez del "✅ hecho" alucinado.
  const claimedMutation = claimsMutation(rawText);
  const mutationGuard = mutationClaimWithoutAction(rawText, mutatingCalls.length);
  // P0 — Guard de honestidad de ESCALACIÓN: si el agente afirma "ya le avisé al
  // doctor" pero ninguna tool de escalación corrió, evita la falsa tranquilidad.
  const escalatedThisTurn = result.toolCalls.some(
    (c) => ESCALATION_TOOLS.has(c.tool) && c.ok !== false
  );
  const escalationGuard = escalationClaimWithoutAction(rawText, escalatedThisTurn);
  // P0 — Honestidad de PAGO EN REVISIÓN (Capa 5): si confirmar_anticipo dejó el
  // comprobante pendiente de confirmación humana y aun así el texto afirma la
  // cita como confirmada, se reescribe (el paciente no debe leer "confirmada"
  // hasta que una persona valide el anticipo en el panel).
  const paymentGuard = paymentPendingConfirmClaim(rawText, result.toolCalls);
  // P0 — Guard de CAPACIDADES (Capa 9): la ráfaga pidió un tema fuera de
  // alcance (factura/reembolso/cambio de doctor/legal) y ninguna tool de
  // escalación corrió → cierre honesto + notificación real al equipo.
  // Solo mensajes de TEXTO: captions/filenames de media ("factura.pdf" como
  // comprobante) no deben disparar el guard.
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

  // P2a — caja negra durable del turno (mismo helper que el concierge; cierra la
  // asimetría de observabilidad entre ambos agentes). Best-effort.
  recordAgentTrace(db, {
    agent: "recepcionista",
    clinicId: contact.clinicId,
    conversationId,
    model: modelLabel,
    startedAtMs,
    result,
    mutations: mutatingCalls.length,
    claimedMutation,
    guardTriggered,
  });

  // Traza "behind the scenes" en consola (espeja la del concierge): qué tools llamó
  // y qué mutaciones ejecutó este turno.
  const toolTrace = result.toolCalls.map((c) => c.tool).join(" → ") || "(ninguna)";
  console.log(
    `[recepcionista] conv=${conversationId} tools: ${toolTrace}` +
      (mutatingCalls.length
        ? ` | acciones: ${mutatingCalls.map((c) => c.tool).join(", ")}`
        : "")
  );

  // P2b — auditoría durable en el event log: una `accion_agente_ejecutada` por
  // mutación. refs vacío a propósito (la tool ya emitió su evento de dominio con
  // sus refs; este NO debe re-disparar proyecciones de profile). Espeja al concierge.
  for (const c of mutatingCalls) {
    try {
      emitEvent(db, contact.clinicId, {
        type: "accion_agente_ejecutada",
        refs: {},
        payload: {
          agent: "recepcionista",
          conversationId,
          contactId: contact.id,
          tool: c.tool,
          args: c.input,
        },
        actor: db.actor(),
      });
    } catch {
      // observabilidad best-effort: jamás tumbar el turno por la auditoría.
    }
  }

  // Si un guard disparó, sustituimos el texto alucinado por la corrección honesta
  // (voz WhatsApp) antes de sanear/persistir. Se registró en la traza arriba. La
  // escalación tiene prioridad de mensaje (es la más sensible para el paciente).
  if (escalationGuard) {
    console.warn(
      `[recepcionista] guard: claim-escalación-sin-acción reescrito (conv=${conversationId})`
    );
  } else if (paymentGuard) {
    console.warn(
      `[recepcionista] guard: claim-cita-confirmada-con-pago-en-revisión reescrito (conv=${conversationId})`
    );
  } else if (capabilityGuard) {
    console.warn(
      `[recepcionista] guard: tema-fuera-de-alcance (${capabilityTopic!.label}) reescrito (conv=${conversationId})`
    );
  } else if (mutationGuard) {
    console.warn(
      `[recepcionista] guard: claim-sin-acción reescrito (conv=${conversationId})`
    );
  }
  // Notificación del tema fuera de alcance DESACOPLADA de qué guard gana el
  // texto: aunque la escalación-claim o el pago-en-revisión gobiernen el
  // mensaje al paciente, el equipo SIEMPRE se entera del tema de dinero/legal
  // (await barato vs. el turno LLM; el catch jamás tumba el turno). El ÉXITO
  // se rastrea porque decide el copy: solo se le dice al paciente "ya les pasé
  // tu solicitud" si la notificación EXISTE — si falló, el copy no afirma
  // ninguna acción (el agente nunca declara algo que no ocurrió).
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
        `[recepcionista] guard: notificación de tema-fuera-de-alcance FALLÓ (conv=${conversationId}) — copy sin afirmación de aviso`
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

  // 5. Dividir en burbujas (como humano) y persistir cada una + evento SSE.
  const replies = persistReplies(text);

  // "Enriquecer después de responder": en segundo plano (sin demorar la respuesta
  // al lead) extraemos los datos del CRM de forma estructurada y los guardamos
  // garantizado — no dependemos de que el agente "se acuerde" de llamar la tool.
  void extractAndApplyCrm(instance, conversationId, config.modelo).catch(() => {});

  return { ok: true, replies, toolCalls };
}

/**
 * Lector de contexto del CRM (respond-fast, enrich-later). Tarea ÚNICA y
 * enfocada: leer la conversación y devolver, en forma fija (structured output),
 * los datos del contacto claramente confirmados por el paciente. Luego el código
 * los guarda de forma determinista. Por ser una tarea acotada, es mucho más
 * confiable que esperar a que el agente grande llame actualizar_contacto.
 */
const CRM_SCHEMA = z.object({
  nombre: z
    .string()
    .nullable()
    .describe("Nombre del paciente SOLO si lo dijo claramente en el chat; si no, null"),
  ciudad: z
    .string()
    .nullable()
    .describe(
      "Ciudad donde VIVE el paciente, SOLO si él mismo la escribió explícitamente (ej. 'vivo en X', 'soy de X', 'estoy en X'). PROHIBIDO inferirla de la ciudad de la clínica, de la lada del teléfono o del contexto. Si el paciente no dijo dónde vive: null.",
    ),
  procedimientoInteresId: z
    .string()
    .nullable()
    .describe("id EXACTO de un procedimiento del catálogo que le interesa; si no quedó claro, null"),
  clasificacion: z
    .enum(["pregunton", "interesado", "seguimiento_futuro"])
    .nullable()
    .describe(
      "Intención observable del paciente. 'pregunton' = solo pregunta (precio/info) y NO ha pedido agendar — es el default. 'interesado' = pidió horarios y, aun habiéndole dado el precio, sigue queriendo avanzar. 'seguimiento_futuro' = dijo que volverá después. Si no es claro: null. NUNCA marques 'agendado' ni 'anticipo': esos los fija el sistema cuando da datos de pago y cuando paga.",
    ),
});

function looksLikePhone(s: string | undefined): boolean {
  return /^\+?\d[\d\s-]{5,}$/.test((s ?? "").trim());
}

export async function extractAndApplyCrm(
  instance: ProviderInstance,
  conversationId: string,
  modelo: string
): Promise<void> {
  if (!agentRuntimeAvailable()) return;
  const { provider } = instance;
  const conversation = await provider.conversations.get(conversationId).catch(() => null);
  if (!conversation) return;
  const ctx = await provider.contacts.getContext(conversation.contactId).catch(() => null);
  const contact = ctx?.contact;
  if (!contact) return;

  const history = await provider.messages.list(conversationId);
  const turns = history
    .slice(-14)
    .map((m) => `${m.direction === "in" ? "Paciente" : "Karen"}: ${turnContent(m)}`)
    .join("\n");
  const procedures = await provider.procedures.list(true);
  const procList = procedures.map((p) => `${p.id}: ${p.nombre}`).join("; ");

  let obj: z.infer<typeof CRM_SCHEMA>;
  try {
    const chain = resolveAgentModelChain(modelo);
    const r = await withModelFallback(chain, (m) =>
      generateObject({
        model: m,
        schema: CRM_SCHEMA,
        system:
          "Eres un extractor de datos de CRM dental. Lee la conversación y extrae SOLO lo que el PACIENTE confirmó claramente con SUS palabras. Si un dato no se dio o hay duda, devuelve null. NUNCA inventes, adivines ni infieras. Regla crítica de ciudad: la ciudad de la clínica NO es la ciudad del paciente — solo registras ciudad si el paciente escribió explícitamente dónde vive.",
        prompt: `Catálogo (id: nombre): ${procList}\n\nDatos actuales del contacto → nombre: ${contact.nombre ?? "-"}, ciudad: ${contact.ciudad ?? "-"}, clasificación: ${contact.leadClassification?.value ?? "-"}.\n\nConversación:\n${turns}`,
      })
    );
    obj = r.object;
  } catch {
    return;
  }

  // Aplicación DETERMINISTA: solo campos no nulos, sin pisar datos buenos con basura.
  const partial: Record<string, unknown> = {};
  const sinNombre = !contact.nombre || looksLikePhone(contact.nombre) || contact.nombre === contact.whatsappPhone;
  if (obj.nombre?.trim() && sinNombre) partial.nombre = obj.nombre.trim();
  if (obj.ciudad?.trim() && obj.ciudad.trim() !== contact.ciudad) partial.ciudad = obj.ciudad.trim();
  if (
    obj.procedimientoInteresId &&
    procedures.some((p) => p.id === obj.procedimientoInteresId) &&
    obj.procedimientoInteresId !== contact.procedimientoInteresId
  ) {
    partial.procedimientoInteresId = obj.procedimientoInteresId;
  }
  if (Object.keys(partial).length > 0) {
    await provider.contacts.update(contact.id, partial).catch(() => {});
  }
  // Clasificación: embudo "solo avanza" (regla compartida en ./funnel). El
  // extractor solo propone estados blandos (pregunton/interesado/
  // seguimiento_futuro); los estados duros (anticipo_pendiente/agendado) los fija
  // una acción real desde las tools, nunca esta inferencia.
  const actual = contact.leadClassification?.value;
  if (
    obj.clasificacion &&
    obj.clasificacion !== actual &&
    canAdvanceClassification(actual, obj.clasificacion)
  ) {
    await provider.contacts.classify(contact.id, obj.clasificacion).catch(() => {});
  }
}

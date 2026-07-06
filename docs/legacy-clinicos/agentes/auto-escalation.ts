/**
 * Pieza 4 — AUTO-ESCALACIÓN asistida por structured output (solo PACIENTES).
 *
 * Cierra el gap que la guarda de honestidad (mutation-claim.ts) solo *surfacea*:
 * la guarda evita que el agente MIENTA ("ya avisé al doctor" sin avisar), pero NO
 * escala por sí sola. Esta pieza sí escala — como red de seguridad — cuando el
 * paciente describe una bandera roja clínica y el agente NO escaló este turno.
 *
 * Por qué en CÓDIGO y no en el prompt: igual que `extractAndApplyCrm`, no
 * dependemos de que el agente grande "se acuerde" de llamar `escalar_urgente`.
 * Un extractor acotado (tarea única, structured output) es mucho más confiable
 * para una sola decisión binaria que el agente conversacional completo.
 *
 * DISEÑO PARA PRODUCCIÓN (decisiones de seguridad):
 *  1. **Solo pacientes** — es donde un síntoma no escalado es un riesgo clínico
 *     real. El recepcionista (leads) no lo monta.
 *  2. **Post-turno en background** (fire-and-forget, espejo de extractAndApplyCrm):
 *     no añade latencia a la respuesta al paciente.
 *  3. **Pre-filtro barato** (`mentionsSymptom`): el LLM extra SOLO corre si la
 *     ráfaga entrante menciona vocabulario clínico. Un turno de logística
 *     ("¿a qué hora abren?") no gasta nada.
 *  4. **No re-escala** si el agente ya escaló este turno, ni si ya hay una
 *     escalación abierta para la conversación (idempotente) → evita fatiga de
 *     alertas, el riesgo #1 de esta pieza.
 *  5. **Conservador por defecto**: el extractor propone "ninguna" salvo señal
 *     clara; "notificar_doctor" es un FYI no disruptivo (no detiene la IA).
 *  6. **Flag `AUTO_ESCALATION` default-OFF (opt-in)** — al revés de las guardas
 *     (default-on): esto añade un LLM/turno + cambia el comportamiento, así que
 *     se enciende por-cliente a conciencia.
 */
import { generateObject } from "ai";
import { z } from "zod";
import type { ProviderInstance } from "@clinicos/mocks";
import type { Message, NotificationType, EscalationType } from "@clinicos/contracts";
import { resolveAgentModelChain, agentRuntimeAvailable } from "./model";
import { withModelFallback } from "./model-fallback";

/**
 * Pre-filtro determinista y barato: ¿la ráfaga entrante menciona vocabulario
 * clínico/síntoma que justifique gastar el LLM extractor? NO es la decisión de
 * escalar (esa la toma el extractor con criterio) — es solo el gate de costo.
 * Permisivo a propósito: prefiere correr el extractor de más que perderse un
 * síntoma; el extractor es el filtro fino. Exportado para test determinista.
 */
const SYMPTOM_RE =
  /\b(?:dolor|duele|due?len|adolorid|sangr|sangre|fiebre|temperatura|infecci|pus|supur|secre|inflama|hinch|enrojec|rojiz|moret|hematoma|ardor|ard[ae]|punz|mare|desmay|v[oó]mit|n[aá]use|alergi|reacci|brote|ronch|salp|comez[oó]n|picaz|herida|cicatr|sutura|costr|drena|fl[uú]j|huele|caliente|calor\s+en|escalofr[ií]|debilidad|desvanec|p[aá]lid|morad|amoratad|entumec|adormec|no\s+(?:puedo|siento)|urgent|emergenc|grav|empeor|empeora|peor|no\s+para\s+de)/iu;

/**
 * Cobertura explícita en inglés (primer idioma no-español del piloto, ver
 * decisión de producto Capa 4): sin esto, un paciente que describe una
 * bandera roja clínica en inglés nunca dispara el pre-filtro y el extractor
 * de auto-escalación jamás corre para él.
 */
const SYMPTOM_RE_EN =
  /\b(?:pain|hurts?|hurting|bleed(?:ing)?|blood|fever|temperature|infect(?:ion|ed)?|pus|discharg(?:e|ing)|inflam(?:ed|mation)|swoll?en|swelling|redness|reddish|bruis(?:e|ing)|hematoma|burn(?:ing)?|stabbing|dizzy|faint(?:ed|ing)?|vomit(?:ing)?|nause(?:a|ous)|allerg(?:ic|y)|reaction|rash|itch(?:y|ing)?|wound|stitches|suture|scab|drain(?:ing)?|smells?\s+bad|hot\s+to\s+the\s+touch|chills?|weak(?:ness)?|pale|purple|numb(?:ness)?|can['’]?t\s+(?:feel|move)|urgent|emergenc(?:y|ies)|severe|worse|worsening|won['’]?t\s+stop|doesn['’]?t\s+stop|not\s+stopping)\b/iu;

/** ¿La ráfaga entrante menciona algo clínico (español o inglés) que amerite correr el extractor? */
export function mentionsSymptom(text: string): boolean {
  return SYMPTOM_RE.test(text) || SYMPTOM_RE_EN.test(text);
}

/**
 * Activo SOLO si AUTO_ESCALATION=on (opt-in por-cliente). Default OFF: a
 * diferencia de las guardas de honestidad, esta pieza añade un LLM por turno y
 * puede tomar una acción (notificar/escalar), así que se enciende a conciencia.
 */
export function autoEscalationEnabled(): boolean {
  return process.env.AUTO_ESCALATION?.trim().toLowerCase() === "on";
}

/** Acciones que el extractor puede proponer (espejan las tools de escalación). */
const ESCALATION_ACTION_SCHEMA = z.object({
  accion: z
    .enum(["ninguna", "notificar_doctor", "escalar_a_humano", "escalar_urgente"])
    .describe(
      "Qué hacer con el ÚLTIMO turno del paciente. 'ninguna' = el caso está dentro del alcance del agente o ya fue atendido; es el DEFAULT y lo correcto la mayoría de las veces. 'notificar_doctor' = duda clínica legítima fuera de alcance, SIN alarma (solo avisar). 'escalar_a_humano' = el paciente pide al doctor/una persona, o queja, sin urgencia médica. 'escalar_urgente' = BANDERA ROJA clínica (sangrado abundante, fiebre, dolor súbito intenso, signos de infección, reacción adversa, post-operatorio que empeora) o emergencia."
    ),
  motivo: z
    .string()
    .describe("Por qué, en UNA frase breve y concreta para el equipo médico."),
});

/** Resuelve el tipo categórico de escalación a partir de la acción. */
function escalationTipo(accion: string): EscalationType {
  return accion === "escalar_urgente" ? "escalacion_handoff" : "paciente_escribe";
}

/**
 * Red de seguridad post-turno para el agente de PACIENTES. Fire-and-forget:
 * el caller la invoca con `void runAutoEscalation(...).catch(() => {})` después
 * de responder, igual que `extractAndApplyCrm`. Nunca lanza hacia el caller.
 */
export async function runAutoEscalation(
  instance: ProviderInstance,
  conversationId: string,
  modelo: string,
  opts: { escalatedThisTurn: boolean; burst: string[] }
): Promise<void> {
  // Gate 1: flag opt-in. Gate 2: runtime de IA disponible.
  if (!autoEscalationEnabled() || !agentRuntimeAvailable()) return;
  // Gate 3: el agente YA escaló este turno → no dupliques la acción.
  if (opts.escalatedThisTurn) return;
  // Gate 4 (pre-filtro barato): sin vocabulario clínico, ni siquiera gastamos LLM.
  const burstText = opts.burst.join("\n").trim();
  if (!burstText || !mentionsSymptom(burstText)) return;

  const { provider } = instance;

  // Gate 5 (idempotencia): si ya hay una escalación abierta para esta
  // conversación, el equipo ya está al tanto → no re-notifiques (anti-fatiga).
  const abierta = await provider.escalations
    .getForConversation(conversationId)
    .catch(() => null);
  if (abierta && abierta.estado !== "resuelta") return;

  const conversation = await provider.conversations.get(conversationId).catch(() => null);
  if (!conversation) return;
  // Solo corre sobre conversaciones que la IA sigue atendiendo: si ya está en
  // humano/pausada, un humano ya tiene el control.
  if (conversation.iaState && conversation.iaState !== "ia_activa") return;
  const ctx = await provider.contacts.getContext(conversation.contactId).catch(() => null);
  const contact = ctx?.contact;
  if (!contact) return;

  const history = await provider.messages.list(conversationId).catch(() => [] as Message[]);
  const turns = history
    .slice(-12)
    .map((m) => `${m.direction === "in" ? "Paciente" : "Agente"}: ${msgText(m)}`)
    .join("\n");

  let obj: z.infer<typeof ESCALATION_ACTION_SCHEMA>;
  try {
    const chain = resolveAgentModelChain(modelo);
    const r = await withModelFallback(chain, (m) =>
      generateObject({
        model: m,
        schema: ESCALATION_ACTION_SCHEMA,
        system:
          "Eres un triador clínico CONSERVADOR para el asistente de pacientes de una clínica. Tu única tarea: decidir si el ÚLTIMO mensaje del paciente requiere avisar/escalar al equipo médico, mirando la conversación. Regla de oro: ante la duda entre 'ninguna' y escalar, escala SOLO si hay una bandera roja clínica clara; la logística normal (fechas, ubicación, costos, dudas ya resueltas) es 'ninguna'. NO escales por cortesía ni por temas administrativos. Sé breve y concreto en el motivo.",
        prompt: `Procedimiento del paciente: ${ctx?.appointments?.[0]?.motivo ?? "no especificado"}.\n\nConversación reciente:\n${turns}\n\n¿Qué acción amerita el último mensaje del paciente?`,
      })
    );
    obj = r.object;
  } catch {
    return; // best-effort: nunca rompe nada
  }

  if (obj.accion === "ninguna") return;

  const motivo = obj.motivo?.trim() || "El paciente describió algo que amerita atención del equipo.";
  const tipo = escalationTipo(obj.accion);
  const urgente = obj.accion === "escalar_urgente";
  const detenerIa = obj.accion === "escalar_a_humano" || obj.accion === "escalar_urgente";

  // Notificación al equipo (best-effort).
  await provider.notifications
    .create({
      tipo: tipo as NotificationType,
      title: urgente ? "🆘 Auto-escalación urgente" : "Auto-escalación: revisar paciente",
      body: `[auto] ${motivo}`,
      contactId: contact.id,
      conversationId,
    })
    .catch(() => {});

  // Registro de escalación (idempotente en el provider) para escalar_a_humano /
  // escalar_urgente. 'notificar_doctor' queda como FYI no disruptivo (sin record
  // ni handoff): solo avisa, no detiene la IA.
  if (detenerIa) {
    await provider.escalations
      .create({
        conversationId,
        contactId: contact.id,
        tipo,
        ...(urgente ? { urgencia: "urgente" as const } : {}),
        motivo: `[auto] ${motivo}`,
      })
      .catch(() => {});
    await provider.conversations
      .setIaState(conversationId, "humano", {
        pausedUntil: new Date(
          Date.parse(instance.db.now()) + 24 * 60 * 60_000
        ).toISOString(),
      })
      .catch(() => {});
  }

  console.warn(
    `[pacientes] auto-escalación (${obj.accion}) conv=${conversationId}: ${motivo}`
  );
}

/** Representa un mensaje como texto para el extractor (sin formato WhatsApp). */
function msgText(m: Message): string {
  if (m.type === "text") return m.body ?? "";
  if (m.type === "audio") return m.media?.transcript ?? "[nota de voz]";
  if (m.type === "image")
    return `[imagen${m.media?.caption ? ` con texto: "${m.media.caption}"` : ""}]`;
  if (m.type === "video") return "[video]";
  if (m.type === "document")
    return m.media?.transcript ?? `[documento ${m.media?.fileName ?? ""}]`;
  return m.body ?? `[${m.type}]`;
}

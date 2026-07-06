/**
 * Generación REAL de borradores de respuesta con LLM (sugerencias del inbox).
 *
 * El panel de sugerencias del inbox pide 3 borradores para que el humano
 * responda. El MockProvider los arma con plantillas scripted (canned) por
 * tipo/modo/nombre — útiles en demo, pero genéricos: no leen la conversación.
 *
 * Aquí, SOLO en el engine y SOLO si hay proveedor de IA, generamos 3 borradores
 * CONTEXTUALES: reutilizamos el mismo patrón del recepcionista (expediente 360
 * del contacto vía buildContactDossier + datos vivos de la clínica + últimos
 * ~20 mensajes), y pedimos al LLM una respuesta lista para enviar por WhatsApp
 * en es-MX (1–3 frases, texto plano, sin markdown), respetando el modo
 * ("normal" vs "consultor_ventas").
 *
 * NO persiste nada: solo devuelve los textos. El caller (server.ts) los inyecta
 * en el shape AISuggestion que el provider ya generó (id/generatedAt/status),
 * preservando el contrato; si esto falla, el caller conserva los drafts scripted.
 */
import { generateObject } from "ai";
import { z } from "zod";
import type {
  ContactContext,
  PatientProfile,
  SuggestionMode,
} from "@clinicos/contracts";
import type { ProviderInstance } from "@clinicos/mocks";
import { resolveAgentModel, agentRuntimeAvailable } from "./model";
import { buildClinicFacts, localDateBlock } from "./agent-core";

export { agentRuntimeAvailable };

/** Fecha-hora local legible (es-MX) para el dossier. */
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

/** Representa un mensaje (incluido multimedia) como texto para el modelo. */
function turnContent(m: {
  type: string;
  body?: string;
  media?: { transcript?: string; caption?: string; url?: string; fileName?: string };
}): string {
  if (m.type === "text") return m.body ?? "";
  if (m.type === "audio") {
    return m.media?.transcript
      ? `(nota de voz transcrita) ${m.media.transcript}`
      : `[envió una nota de voz]`;
  }
  if (m.type === "image") {
    const cap = m.media?.caption ? ` (con texto: "${m.media.caption}")` : "";
    return m.media?.transcript
      ? `[envió una imagen${cap}. Contenido: ${m.media.transcript}]`
      : `[envió una imagen${cap}]`;
  }
  if (m.type === "video") return `[envió un video]`;
  if (m.type === "document") {
    const fn = m.media?.fileName ?? "";
    return m.media?.transcript
      ? `[envió un documento ${fn}. Contenido: ${m.media.transcript}]`
      : `[envió un documento ${fn}]`;
  }
  return m.body ?? `[${m.type}]`;
}

/**
 * Expediente vivo del contacto (resumen 360 + señales + citas + antecedentes),
 * scoped al contacto. Equivalente compacto al buildContactDossier del
 * recepcionista (Hito 2) — mismo patrón, sin tools.
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
    if (parts.length) lines.push(`Antecedentes — ${parts.join("; ")}.`);
  }

  const procs = profile?.estado.procedimientosDeInteres ?? [];
  if (procs.length) lines.push(`Procedimientos de interés: ${procs.join(", ")}.`);

  if (!lines.length) lines.push("Sin historial registrado todavía (contacto nuevo).");

  return `## Expediente vivo del contacto (SOLO de él — jamás mezcles datos de otras personas)
Nombre: ${contact.nombre ?? "desconocido"} · Tipo: ${contact.tipo} · Ciudad: ${contact.ciudad ?? "?"}
Clasificación: ${contact.leadClassification?.value ?? "sin clasificar"}
${lines.join("\n")}`;
}

/** Limpia un borrador para WhatsApp: sin Markdown, sin signos de apertura. */
function sanitizeForWhatsApp(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/[¿¡]/g, "")
    .trim();
}

const DRAFTS_SCHEMA = z.object({
  drafts: z
    .array(z.string())
    .length(3)
    .describe(
      "Exactamente 3 borradores ALTERNATIVOS de respuesta, cada uno listo para enviar por WhatsApp tal cual."
    ),
});

/**
 * Genera 3 borradores de respuesta CONTEXTUALES para una conversación, en estilo
 * WhatsApp es-MX, respetando el modo. Reutiliza el contexto del recepcionista
 * (dossier + datos vivos + últimos ~20 mensajes). Lanza si no hay IA o si falla:
 * el caller decide el fallback a las plantillas scripted del provider.
 */
export async function generateSuggestionDrafts(
  instance: ProviderInstance,
  conversationId: string,
  mode: SuggestionMode
): Promise<string[]> {
  if (!agentRuntimeAvailable()) {
    throw new Error("Sin proveedor de IA configurado");
  }

  const { provider, db } = instance;

  const conversation = await provider.conversations.get(conversationId);
  const context = await provider.contacts.getContext(conversation.contactId);
  const contact = context.contact;

  // Otros (equipo/proveedor) no llevan borradores de IA — atención humana.
  // Espejo de la regla del MockProvider (buildDrafts).
  if (contact.tipo === "equipo" || contact.tipo === "proveedor") {
    return [];
  }

  // Profile 360 (get-or-reproject), mismo patrón que el recepcionista.
  const profileRaw =
    (await provider.profiles.get("patient", contact.id).catch(() => null)) ??
    (await provider.profiles.reproject("patient", contact.id).catch(() => null));
  const profile = profileRaw?.entityType === "patient" ? profileRaw : null;

  const settings = await provider.settings.get().catch(() => null);
  const tz = settings?.timezone || "America/Mexico_City";

  const agents = await provider.agents.list().catch(() => []);
  const config = agents.find((a) => a.key === "recepcionista" && a.activo);
  const modelo = config?.modelo ?? "deepseek";

  const clinicFacts = await buildClinicFacts(provider);
  const dossier = buildContactDossier(context, profile, db.now(), tz);

  const history = await provider.messages.list(conversationId);
  const turns = history
    .slice(-20)
    .map((m) => `${m.direction === "in" ? "Paciente" : "Nosotros"}: ${turnContent(m)}`)
    .join("\n");

  const esLead = contact.tipo !== "paciente";
  const focoBase = esLead
    ? "Es un LEAD (aún no es paciente): el objetivo es generar interés, resolver dudas y avanzar hacia agendar una valoración."
    : "Ya es PACIENTE: el objetivo es atención cálida, dar seguimiento a su tratamiento y resolver lo que necesite.";
  const focoModo =
    mode === "consultor_ventas"
      ? esLead
        ? "MODO CONSULTOR DE VENTAS: enfócate en cerrar — maneja objeciones con empatía, transmite valor y empuja (sin presionar de más) a apartar con anticipo."
        : "MODO CONSULTOR DE VENTAS: enfócate en upsell — propón la siguiente fase del tratamiento o un complemento que potencie sus resultados."
      : "MODO NORMAL: responde de forma natural y servicial a lo último que escribió, sin forzar una venta.";

  const system = [
    "Eres una recepcionista real de una clínica en México que escribe por WhatsApp. Te piden 3 BORRADORES alternativos de respuesta para el último mensaje del paciente, para que un humano elija o edite uno.",
    clinicFacts,
    dossier,
    localDateBlock(db.now(), tz),
    `## Tu tarea
${focoBase}
${focoModo}

Genera 3 borradores ALTERNATIVOS (distintos entre sí en enfoque o tono) que respondan de forma CONTEXTUAL a lo ÚLTIMO que dijo el paciente — usa su nombre, su situación y su historial; NO escribas respuestas genéricas que servirían para cualquiera.

Reglas de estilo (innegociables):
- Español mexicano, cálido y natural, como una persona real (nunca digas que eres IA).
- TEXTO PLANO de WhatsApp: nada de Markdown (sin **negritas**, sin ## títulos, sin viñetas).
- Corto: 1 a 3 frases por borrador. Máximo una pregunta por borrador. Sin emojis excesivos.
- Puntuación: usa SOLO signos de cierre ("?" y "!"); NUNCA escribas "¿" ni "¡".
- No inventes precios, horarios, links ni datos bancarios: usa solo lo que esté en los datos vivos; si falta un dato, ofrece confirmarlo.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const { object } = await generateObject({
    model: resolveAgentModel(modelo),
    schema: DRAFTS_SCHEMA,
    system,
    prompt: `Conversación reciente:\n${turns || "(sin mensajes todavía)"}\n\nEscribe los 3 borradores.`,
  });

  const drafts = object.drafts
    .map((d) => sanitizeForWhatsApp(d))
    .filter((d) => d.length > 0);

  if (!drafts.length) throw new Error("El modelo no devolvió borradores");
  return drafts.slice(0, 3);
}

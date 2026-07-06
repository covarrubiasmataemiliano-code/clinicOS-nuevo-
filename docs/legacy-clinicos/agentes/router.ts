/**
 * Router de agente por INTENCIÓN (Opción A) — decide, por turno, qué agente
 * conduce una conversación de WhatsApp: el recepcionista (leads/ventas) o el
 * agente de pacientes (journey clínico post-conversión).
 *
 * Fundamentado en el PANORAMA del contacto (no en el texto a secas):
 *  0. Kill-switch `PACIENTES_AGENT_ENABLED=false` → recepcionista (espeja el gate
 *     de runPacientes para no rutear a un agente que se negará a responder).
 *  1. Sin un agente de pacientes activo en la clínica → recepcionista.
 *  2. Contacto que no es paciente, o sin procedimiento en journey ACTIVO
 *     (preparacion/cuidado/seguimiento; `mantenimiento` es cola larga = no
 *     journey activo) → recepcionista.
 *  3. Con journey activo → pacientes, SALVO que el burst entrante traiga una
 *     consulta de COMPRA NUEVA (precio/cotización) — eso es venta → recepcionista.
 *
 * Heurística determinista (sin LLM) en v1: barata, predecible y testeable. El
 * refinamiento futuro es un clasificador LLM cuando la heurística sea ambigua
 * (p.ej. interés en un tratamiento nuevo SIN palabras de precio). Ante cualquier
 * fallo cae a "recepcionista" (nunca rompe el pipeline inbound).
 */
import type { ProviderInstance } from "@clinicos/mocks";
import type { AgentKey } from "./agent-registry";

/** Señales de intención de COMPRA NUEVA (territorio de ventas/recepción). */
const NEW_PURCHASE_RE =
  /\bprecio\b|\bcosto\b|\bcu[aá]nto\s+(?:cuesta|sale|vale)\b|\bcotiz|\bpresupuesto\b|\bpromoci[oó]n/i;

/**
 * ¿El texto parece una consulta de COMPRA NUEVA (precio/cotización)? Pura y
 * determinista — la parte fuzzy del router, aislada para poder testearla.
 */
export function looksLikeNewPurchase(text: string): boolean {
  return NEW_PURCHASE_RE.test(text);
}

export async function selectAgentByIntent(
  instance: ProviderInstance,
  conversationId: string
): Promise<AgentKey> {
  const { provider } = instance;
  // Kill-switch de runtime: si el agente de pacientes está apagado, ni siquiera
  // lo consideramos (runPacientes se negaría → paciente sin respuesta).
  if (process.env.PACIENTES_AGENT_ENABLED === "false") return "recepcionista";
  try {
    const agents = await provider.agents.list();
    if (!agents.some((a) => a.key === "pacientes" && a.activo))
      return "recepcionista";

    const conv = await provider.conversations.get(conversationId);
    const contact = await provider.contacts.get(conv.contactId);
    if (contact.tipo !== "paciente") return "recepcionista";

    // Journey ACTIVO = procedimiento en preparacion/cuidado/seguimiento.
    // `mantenimiento` (cola larga, p.ej. >90 días) NO cuenta: un paciente viejo
    // que vuelve por algo nuevo debe ir a recepción (lead/venta), no quedar
    // atrapado en el agente de cuidado para siempre.
    const procs = await provider.patientProcedures.listForContact(contact.id);
    const enJourneyActivo = procs.some(
      (p) => p.status === "activo" && p.etapa !== "mantenimiento"
    );
    if (!enJourneyActivo) return "recepcionista";

    // Intención sobre el BURST actual (todos los entrantes desde la última
    // salida), no solo el último mensaje: la pregunta de compra puede no ser la
    // última de la ráfaga.
    const msgs = await provider.messages.list(conversationId);
    const burst: string[] = [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!m) continue;
      if (m.direction === "out") break;
      if (m.type === "text" && m.body) burst.push(m.body);
    }
    if (burst.some(looksLikeNewPurchase)) return "recepcionista";

    return "pacientes";
  } catch {
    return "recepcionista";
  }
}

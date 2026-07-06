/**
 * Guard de CAPACIDADES NO SOPORTADAS (Capa 9, remediación recepcionista) —
 * patrón de dos capas espejo de mentionsSymptom/runAutoEscalation, pero 100%
 * determinista (sin LLM).
 *
 * El hueco: facturas, reembolsos, cambio de doctor y temas legales dependen
 * solo de la regla blanda del prompt ("si no está en tus herramientas,
 * escala"). Si el modelo responde el tema sin escalar, nadie del equipo se
 * entera y el paciente recibe una respuesta inventada.
 *
 * Capa 1 (pre-filtro de costo): patrones sobre el texto ENTRANTE de la ráfaga
 * (solo mensajes de TEXTO — captions/filenames de media quedan fuera para no
 * chocar con comprobantes tipo "factura.pdf" o "aquí está mi factura").
 * Capa 2 (post-turno): si hubo hit Y ninguna tool de escalación corrió este
 * turno, la respuesta se sustituye por un cierre honesto que refiere al equipo
 * (igual que mutation-claim) y se notifica al panel para que el "ya le pasé tu
 * solicitud al equipo" sea VERDAD, no otra promesa hueca. La notificación se
 * emite AUNQUE otro guard de mayor prioridad gane el texto del mensaje (el
 * equipo debe enterarse del tema de dinero/legal en cualquier caso).
 *
 * Trade-off documentado: si la ráfaga mezcla un tema fuera de alcance con uno
 * normal ("¿me dan factura? y ¿a qué hora abren?"), el turno completo se
 * sustituye. Preferimos perder una respuesta mixta a dejar pasar un tema de
 * dinero/legal sin ojo humano; el paciente puede re-preguntar lo normal.
 */
import type { NotificationType } from "@clinicos/contracts";

export interface UnsupportedTopic {
  /** Etiqueta humana para la notificación/log. */
  label: string;
  /**
   * Tipo de notificación: factura y cambio de doctor son logística
   * (lead_fuera_alcance, urgencia "aviso", respeta horario silencioso);
   * reembolso y legal son dinero/queja (escalacion_handoff, urgente).
   */
  tipo: NotificationType;
}

/** Temas fuera del alcance del recepcionista. */
const TOPICS: ReadonlyArray<UnsupportedTopic & { re: RegExp }> = [
  {
    label: "factura/CFDI",
    tipo: "lead_fuera_alcance",
    // "factura(s)/facturar", "CFDI" y la familia "recibo/comprobante/datos
    // fiscales" (en MX pedir "lo fiscal" ES pedir factura).
    re: /\bfactur|\bcfdi\b|\bfiscal(?:es)?\b/iu,
  },
  {
    label: "reembolso/devolución",
    tipo: "escalacion_handoff",
    // "reembolso"/"devolución" sueltos (ya específicos), o devolver/regresar
    // ANCLADO al clítico receptor me/nos + dinero/anticipo/pago/apartado. La
    // direccionalidad distingue el reembolso real ("ME regresan MI anticipo")
    // del happy-path de coordinación ("cuando regrese LES hago el pago").
    re: /\breembols|\bdevoluci[óo]n\b|\b(?:me|nos)\s+(?:pueden\s+|puedes\s+|van\s+a\s+)?(?:devolver|devuelv\w*|regres\w*)\b[^.!?\n]{0,25}\b(?:dinero|anticipo|pago|apartado|dep[óo]sito)\b/iu,
  },
  {
    label: "cambio de doctor",
    tipo: "lead_fuera_alcance",
    // Exige el acto de SUSTITUIR al médico ("cambiar DE doctor", "cambiarme a/
    // con otro doctor"), no el de mover una cita ("cambiar mi cita con el
    // doctor" es reagenda soportada y NO debe casar).
    re: /\bcambi\w*\b\s+de\s+(?:doctor|doctora|dr\.?|m[eé]dic[oa])\b|\b(?:a|con)\s+otr[oa]\s+(?:doctor|doctora|dr\.?|m[eé]dic[oa])\b/iu,
  },
  {
    label: "tema legal",
    tipo: "escalacion_handoff",
    // Contexto legal explícito: "demanda" suelta NO casa ("mucha demanda de
    // citas" es volumen, no litigio).
    re: /\b(?:poner|meter|levantar|interponer)\b[^.!?\n]{0,15}\bdemanda\b|\bdemandar\w*\b|(?<!\p{L})demand[ée](?!\p{L})|\babogad[oa]s?\b|\btema\s+legal\b|\bacci[óo]n\s+legal\b|\bv[íi]a\s+legal\b/iu,
  },
];

/** ¿La ráfaga entrante menciona un tema no soportado? Devuelve el tema o null. */
export function unsupportedTopicIn(
  burst: ReadonlyArray<string>
): UnsupportedTopic | null {
  const text = burst.join("\n");
  for (const t of TOPICS) {
    if (t.re.test(text)) return { label: t.label, tipo: t.tipo };
  }
  return null;
}

/**
 * Activo salvo CAPABILITY_GUARD=off (flag runtime por-cliente, espeja
 * MUTATION_CLAIM_GUARD / PAYMENT_CLAIM_GUARD).
 */
export function capabilityGuardEnabled(): boolean {
  return process.env.CAPABILITY_GUARD?.trim().toLowerCase() !== "off";
}

/**
 * ¿Disparar? Sí cuando: guard activo, la ráfaga trae un tema no soportado y
 * NINGUNA tool de escalación (notificar_doctor/escalar_a_humano/escalar_urgente)
 * corrió este turno. Devuelve el tema (label + tipo de notificación) o null.
 */
export function capabilityEscalationRequired(
  burst: ReadonlyArray<string>,
  escalatedThisTurn: boolean
): UnsupportedTopic | null {
  if (!capabilityGuardEnabled() || escalatedThisTurn) return null;
  return unsupportedTopicIn(burst);
}

/**
 * Cierre cara-a-paciente (voz WhatsApp, texto plano, solo signos de cierre):
 * honesto porque el guard SÍ notificó al equipo al dispararse. Los call sites
 * SOLO deben usar este copy cuando `notifications.create` tuvo éxito — si
 * falló, el "ya les pasé tu solicitud" sería mentira (usar el copy de abajo).
 */
export const CAPABILITY_GUARD_REPLY =
  "Ese tema lo ve directamente el equipo de la clínica, no lo manejo yo por aquí. Ya les pasé tu solicitud para que te contacten y lo resuelvan contigo; si es urgente márcanos por favor.";

/**
 * Variante para cuando la notificación al panel FALLÓ: no afirma ninguna
 * acción operacional ("ya avisé/pasé/notifiqué") — dirige al paciente a
 * contactar a la clínica directamente. El agente nunca debe afirmar una
 * acción que no ocurrió.
 */
export const CAPABILITY_GUARD_REPLY_UNNOTIFIED =
  "Ese tema lo ve directamente el equipo de la clínica, no lo manejo yo por aquí. Márcanos por teléfono o escríbenos en horario de atención para que lo resuelvan contigo directamente, por favor.";

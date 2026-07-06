/**
 * Guard de honestidad de PAGO EN REVISIÓN (Capa 5, remediación recepcionista) —
 * hermano de mutation-claim.ts.
 *
 * Decisión de producto: la IA PREVALIDA el comprobante pero NO registra dinero;
 * `confirmar_anticipo` deja el pago "pendiente" de confirmación humana en el
 * panel. Criterio operativo aprobado: el paciente NO debe leer "tu cita quedó
 * confirmada/lista" hasta que una persona confirme el anticipo en ClinicOS.
 *
 * El prompt ya lo instruye (la `nota` de la tool lo repite), pero igual que con
 * los otros claims, el modelo puede desobedecer. Este guard lo detecta de forma
 * determinista: si en el MISMO turno la tool devolvió `pendienteRevision:true`
 * y el texto AFIRMA la cita como confirmada, se reescribe a la versión honesta.
 * Turnos posteriores (donde la cita ya puede estar confirmada por el humano) no
 * disparan: el guard exige la co-ocurrencia con el resultado pendiente.
 */

/**
 * AFIRMACIÓN de cita confirmada/asegurada. Evalúa por ORACIÓN: una frase que
 * afirma ("tu cita ya quedó confirmada") dispara; la misma idea condicionada a
 * la revisión ("en cuanto el equipo lo valide te confirmo la cita") NO, porque
 * la oración contiene un marcador de pendiente.
 */
export const APPOINTMENT_CONFIRMED_CLAIM_RE =
  /(?:tu|la|su)\s+cita[^.!?\n]{0,40}(?:qued[óo]|est[áa]|ya\s+est[áa])\s+(?:confirmad|asegurad|apartad|list)|(?:ya\s+)?(?:qued[óo]|est[áa])\s+confirmad|confirmamos\s+tu\s+cita|cita\s+confirmada|tu\s+lugar\s+(?:ya\s+)?(?:qued[óo]|est[áa])\s+(?:asegurad|apartad|confirmad)/iu;

/** Marcadores de "todavía no": si la oración los trae, no es una afirmación. */
const PENDING_MARKER_RE =
  /en\s+cuanto|cuando\s+(?:el\s+equipo|lo\s+valid|lo\s+confirm|lo\s+revis)|revisi[óo]n|valid(?:e|en|ar)|por\s+confirmar|todav[íi]a\s+no|a[úu]n\s+no|una\s+vez\s+que/iu;

/** ¿El texto AFIRMA (en alguna oración sin marcador de pendiente) que la cita está confirmada? */
export function claimsAppointmentConfirmed(text: string): boolean {
  return text
    .split(/[.!?\n]+/)
    .some(
      (s) =>
        APPOINTMENT_CONFIRMED_CLAIM_RE.test(s) && !PENDING_MARKER_RE.test(s)
    );
}

/**
 * Activo salvo PAYMENT_CLAIM_GUARD=off (flag runtime por-cliente, espeja
 * MUTATION_CLAIM_GUARD / ESCALATION_CLAIM_GUARD).
 */
export function paymentClaimGuardEnabled(): boolean {
  return process.env.PAYMENT_CLAIM_GUARD?.trim().toLowerCase() !== "off";
}

/** Forma mínima del tool-call que necesita el guard (subset de AgentTurnToolCall). */
export interface ToolCallLike {
  tool: string;
  ok?: boolean;
  output?: unknown;
}

/** ¿Este turno dejó un comprobante EN REVISIÓN (pendiente de humano)? */
export function receiptPendingThisTurn(
  toolCalls: ReadonlyArray<ToolCallLike>
): boolean {
  return toolCalls.some(
    (c) =>
      c.tool === "confirmar_anticipo" &&
      c.ok !== false &&
      typeof c.output === "object" &&
      c.output !== null &&
      (c.output as { pendienteRevision?: unknown }).pendienteRevision === true
  );
}

/**
 * ¿Disparar la corrección? Sí cuando: guard activo, la tool dejó el comprobante
 * pendiente de revisión este turno, y el texto AFIRMA la cita como confirmada.
 */
export function paymentPendingConfirmClaim(
  text: string,
  toolCalls: ReadonlyArray<ToolCallLike>
): boolean {
  return (
    paymentClaimGuardEnabled() &&
    receiptPendingThisTurn(toolCalls) &&
    claimsAppointmentConfirmed(text)
  );
}

/**
 * Corrección cara-a-paciente (voz WhatsApp, sin Markdown, solo signos de
 * cierre): honesta — el comprobante se recibió y está en revisión; la cita se
 * confirma cuando el equipo valide el anticipo.
 */
export const PAYMENT_PENDING_REPLY =
  "Gracias! Ya recibí tu comprobante y quedó en revisión del equipo para validar tu anticipo. En cuanto lo confirmen te aviso por aquí con tu cita ya asegurada, fecha y hora.";

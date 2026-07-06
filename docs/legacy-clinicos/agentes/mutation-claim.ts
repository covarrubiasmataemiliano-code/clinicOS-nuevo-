/**
 * Guard anti "claim-sin-acción" — garantía en CÓDIGO de que un agente nunca
 * declare un hecho de mutación que NINGUNA herramienta ejecutó este turno.
 *
 * Por qué en código y no en el prompt: la regla "solo di 'ya quedó agendada/
 * cancelada/pagada' después de que la tool devolvió ok" vive hoy en los
 * `## Reglas` de cada agente, pero el LLM puede olvidarla y alucinar el "✅
 * hecho". Este módulo lo detecta de forma determinista (el texto AFIRMA una
 * mutación) y, cruzándolo con el conteo real de mutaciones del turno, deja que
 * cada agente reescriba la respuesta a una corrección honesta.
 *
 * Origen: extraído del `MUTATION_CLAIM_RE` del concierge (concierge-llm.ts) para
 * compartirlo con recepcionista y pacientes sin duplicar el regex. El concierge
 * conserva su propio texto de corrección (voz staff); los agentes cara-a-paciente
 * usan `MUTATION_CLAIM_REPLY` (voz WhatsApp, sin Markdown, solo signos de cierre).
 */

/**
 * Detecta frases en 1ª persona que AFIRMAN una mutación ("eliminé", "agendé",
 * "ya quedó cancelado"). Verbos en pretérito con acento obligatorio (lookaround
 * unicode) → alta precisión; los participios sueltos ("bloqueado", "agendado")
 * NO disparan, para no chocar con lecturas que describen el estado ("tienes 1
 * evento bloqueado", "tu cita quedó agendada el martes" en pasado de lectura no
 * casa porque exige el patrón "ya quedó ... agendad").
 */
export const MUTATION_CLAIM_RE =
  /(?<!\p{L})(?:elimin|borr|cancel|agend|reagend|bloque|desbloque|registr|guard|actualic|envi|cre|confirm|program)é(?!\p{L})|(?<!\p{L})mov[íi](?!\p{L})|ya\s+(?:quedó|quedo|está)[^.!?\n]{0,40}(?:eliminad|cancelad|agendad|reagendad|registrad|cread|enviad|guardad|bloquead|actualizad)/iu;

/** ¿El texto AFIRMA una mutación (sin verificar si de verdad ocurrió)? */
export function claimsMutation(text: string): boolean {
  return MUTATION_CLAIM_RE.test(text);
}

/**
 * El guard está activo salvo que se apague explícitamente con
 * MUTATION_CLAIM_GUARD=off (flag runtime por-cliente, espeja injectionGuardEnabled).
 */
export function mutationClaimGuardEnabled(): boolean {
  return process.env.MUTATION_CLAIM_GUARD?.trim().toLowerCase() !== "off";
}

/**
 * ¿Disparar la corrección? Sí cuando: el guard está activo, el texto AFIRMA una
 * mutación, y NINGUNA herramienta de cambio se ejecutó este turno. Un solo punto
 * de verdad para los tres agentes.
 */
export function mutationClaimWithoutAction(
  text: string,
  mutationsThisTurn: number
): boolean {
  return mutationClaimGuardEnabled() && mutationsThisTurn === 0 && claimsMutation(text);
}

/**
 * Corrección cara-a-paciente (WhatsApp): texto plano, sin Markdown, solo signos
 * de cierre. No le declara el hecho — pide un momento y reintenta con honestidad.
 */
export const MUTATION_CLAIM_REPLY =
  "Perdona, déjame confirmar bien ese cambio antes de darte el dato para no decirte algo a medias. Permíteme un momento y enseguida te aviso.";

/**
 * Guard de HONESTIDAD DE ESCALACIÓN — hermano del de mutación, pero para el aviso
 * al equipo/doctor. Los prompts mandan: "solo dile 'ya le avisé al doctor' DESPUÉS
 * de que la herramienta lo confirme". Si el agente lo AFIRMA pero ninguna tool de
 * escalación corrió, el paciente recibe una falsa tranquilidad (cree que el doctor
 * ya sabe de su caso) — peligroso cuando hay un síntoma. El regex de mutación NO
 * lo cubre: "avisé/notifiqué/escalé" no son verbos de cambio de estado.
 *
 * Detecta 1ª persona pretérito (avisé/notifiqué/escalé/reporté/comenté/consulté)
 * ligada a un sujeto de staff (doctor/equipo/médico/especialista) en una ventana
 * corta, más un par de formas pasivas ("el doctor ya está enterado"). Los tiempos
 * presente/futuro/infinitivo ("te aviso en cuanto…", "voy a avisarle") NO casan.
 */
export const ESCALATION_CLAIM_RE =
  /(?<!\p{L})(?:avis|notifiqu|escal|report|coment|consult)é(?!\p{L})[^.!?\n]{0,30}(?:doctor|doctora|dr\.?|m[eé]dic[oa]|especialista|equipo)\b|(?:el\s+)?(?:doctor|doctora|dr\.?|m[eé]dic[oa]|equipo)[^.!?\n]{0,25}(?:ya\s+)?(?:est[áa]|qued[óo])\s+(?:avisad|notificad|enterad|informad)/iu;

/** ¿El texto AFIRMA haber escalado/avisado al equipo? (sin verificar si pasó). */
export function claimsEscalation(text: string): boolean {
  return ESCALATION_CLAIM_RE.test(text);
}

/**
 * Activo salvo ESCALATION_CLAIM_GUARD=off. Flag propio (independiente del de
 * mutación) por si una clínica quiere afinar uno sin tocar el otro.
 */
export function escalationClaimGuardEnabled(): boolean {
  return process.env.ESCALATION_CLAIM_GUARD?.trim().toLowerCase() !== "off";
}

/**
 * ¿Disparar la corrección de escalación? Sí cuando: guard activo, el texto AFIRMA
 * un aviso al equipo, y NINGUNA tool de escalación (notificar_doctor /
 * escalar_a_humano / escalar_urgente) corrió este turno.
 */
export function escalationClaimWithoutAction(
  text: string,
  escalatedThisTurn: boolean
): boolean {
  return escalationClaimGuardEnabled() && !escalatedThisTurn && claimsEscalation(text);
}

/**
 * Corrección cara-a-paciente para la escalación: NO le declara que ya avisó al
 * doctor (no pasó). Queda honesta y lo mantiene acompañado; el miss se registra
 * en la traza + console.warn para que el equipo lo vea y dé seguimiento.
 */
export const ESCALATION_CLAIM_REPLY =
  "Déjame confirmarlo con el equipo para darte una respuesta segura. Permíteme un momento y te escribo en cuanto lo tenga; si es algo urgente, márcanos por favor.";

/** Tools que SÍ cuentan como una escalación real al equipo/doctor. */
export const ESCALATION_TOOLS: ReadonlySet<string> = new Set([
  "notificar_doctor",
  "escalar_a_humano",
  "escalar_urgente",
]);

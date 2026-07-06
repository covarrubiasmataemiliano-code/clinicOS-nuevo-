/**
 * Embudo de clasificación del lead — FUENTE ÚNICA DE VERDAD.
 *
 * Antes este modelo vivía DUPLICADO en `tools.ts` (advanceClassification) y en
 * `recepcionista.ts` (extractAndApplyCrm). Dos copias = riesgo de que diverjan y
 * el embudo se comporte distinto según quién lo toque. Aquí queda una sola
 * definición que ambos importan.
 *
 * Principios (el embudo es autoritativo en CÓDIGO, no en el prompt):
 *  - Estados DUROS (`anticipo_pendiente`, `agendado`) los fijan ACCIONES reales
 *    (enviar datos bancarios, crear cita, confirmar pago) desde las tools, nunca
 *    la adivinanza del modelo.
 *  - "Solo avanza": jamás se degrada a un lead que ya committió.
 *  - `seguimiento_futuro`/`spam` son laterales: solo aplican si el lead aún no
 *    entró al embudo de pago (rank < anticipo_pendiente).
 */
import type { LeadClassificationValue } from "@clinicos/contracts";

/** Rango del embudo de pago. Estado lateral (seguimiento_futuro/spam) = no listado. */
export const FUNNEL_RANK: Record<string, number> = {
  pregunton: 0,
  interesado: 1,
  anticipo_pendiente: 2,
  agendado: 3,
};

/** Rango de un valor de clasificación; -1 si es lateral o desconocido. */
export function rankOf(value: string | undefined | null): number {
  return value ? (FUNNEL_RANK[value] ?? -1) : -1;
}

/**
 * ¿Se permite mover la clasificación de `current` → `target`?
 * Centraliza la regla "solo avanza" + el caso lateral. No toca la BD: es una
 * decisión pura que el caller usa antes de persistir.
 */
export function canAdvanceClassification(
  current: string | undefined | null,
  target: LeadClassificationValue
): boolean {
  const curRank = rankOf(current);
  if (target === "seguimiento_futuro" || target === "spam") {
    // lateral: no degradar a quien ya está en el embudo de pago
    return curRank < (FUNNEL_RANK.anticipo_pendiente ?? 2);
  }
  return rankOf(target) > curRank;
}

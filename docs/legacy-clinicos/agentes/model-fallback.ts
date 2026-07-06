/**
 * Red de seguridad de modelos (portada de Aria, `src/lib/llm.js`).
 *
 * El AI SDK llama UN modelo por invocación y, si ese modelo falla por rate-limit
 * (429), indisponibilidad (503), sin-créditos (402) o un id retirado (400/404),
 * el turno se cae y el paciente queda sin respuesta. Aria evita esto reintentando
 * con el siguiente modelo de una cadena. `withModelFallback` replica eso de forma
 * agnóstica: recibe una cadena de modelos ya construidos y un ejecutor; ante un
 * error a NIVEL DE MODELO prueba el siguiente; ante un error de prompt/lógica
 * (que cambiar de modelo NO arregla) propaga de inmediato.
 */
import { APICallError } from "ai";
import type { LanguageModel } from "ai";

/**
 * Status que justifican cambiar de modelo (igual que Aria): problema del modelo
 * o del proveedor, no del prompt. 401/403 (auth) y 4xx de validación NO entran:
 * reintentar con otro modelo no los arregla.
 */
const FALLBACK_STATUSES: ReadonlySet<number> = new Set([
  400, 402, 404, 408, 429, 500, 502, 503,
]);

/** ¿El error es a nivel de modelo/proveedor (vale la pena el fallback)? */
export function isModelLevelError(err: unknown): boolean {
  let status: number | undefined;
  if (APICallError.isInstance(err)) {
    status = err.statusCode;
  } else {
    // Algunos proveedores envuelven el error; intenta leer un statusCode genérico.
    const s = (err as { statusCode?: unknown })?.statusCode;
    if (typeof s === "number") status = s;
  }
  return status != null && FALLBACK_STATUSES.has(status);
}

/**
 * Ejecuta `run` con el primer modelo de la cadena; ante un error a nivel de
 * modelo, reintenta con el siguiente. El último modelo (o un error no-de-modelo)
 * propaga. `onFallback` permite loguear el salto (observabilidad).
 */
export async function withModelFallback<T>(
  models: LanguageModel[],
  run: (model: LanguageModel) => Promise<T>,
  onFallback?: (info: { from: number; to: number; err: unknown }) => void
): Promise<T> {
  if (models.length === 0) {
    throw new Error("withModelFallback: cadena de modelos vacía");
  }
  let lastErr: unknown;
  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;
    try {
      return await run(model);
    } catch (err) {
      lastErr = err;
      const hasNext = i < models.length - 1;
      if (hasNext && isModelLevelError(err)) {
        onFallback?.({ from: i, to: i + 1, err });
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

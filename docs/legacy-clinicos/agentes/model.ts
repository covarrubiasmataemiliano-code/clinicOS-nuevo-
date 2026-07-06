/**
 * Selector de proveedor de modelo (agnóstico, vía Vercel AI SDK).
 *
 * Cada clínica trae SU propia cuenta en SU propio `.env`. El motor usa la que
 * encuentre, en este orden:
 *   1. OPENROUTER_API_KEY → OpenRouter (una llave, cientos de modelos: DeepSeek,
 *      GPT, Claude, Gemini, Qwen… con tope de gasto).
 *   2. OPENAI_API_KEY → API de OpenAI o cualquier endpoint compatible (OPENAI_BASE_URL).
 *   3. ANTHROPIC_API_KEY → Claude directo.
 *
 * El modelo concreto del agente: AGENT_MODEL del entorno → mapeo del campo
 * `modelo` del AgentConfig → default por proveedor.
 *
 * Visión: DeepSeek (y muchos modelos baratos) NO leen imágenes. Las tools que
 * necesitan ver un comprobante o fotos usan `resolveVisionModel()`, un modelo
 * multimodal barato (configurable con VISION_MODEL), independiente del cerebro
 * conversacional. Así el agente corre en DeepSeek (económico) y solo paga visión
 * cuando de verdad llega una imagen.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/** Mapa del campo `modelo` del AgentConfig → id real por proveedor. */
const ANTHROPIC_MAP: Record<string, string> = {
  "claude-sonnet": "claude-sonnet-4-6",
  "claude-haiku": "claude-haiku-4-5-20251001",
  "claude-opus": "claude-opus-4-8",
};
const OPENROUTER_MAP: Record<string, string> = {
  deepseek: "deepseek/deepseek-v4-flash",
  "deepseek-pro": "deepseek/deepseek-v4-pro",
  "claude-sonnet": "anthropic/claude-sonnet-4.6",
  "claude-haiku": "anthropic/claude-haiku-4.5",
  "claude-opus": "anthropic/claude-opus-4.8",
};
const OPENAI_MAP: Record<string, string> = {
  "claude-sonnet": "gpt-5.4",
  "claude-haiku": "gpt-5.4-mini",
  "claude-opus": "gpt-5.4",
};

/**
 * Default por proveedor si no hay AGENT_MODEL ni mapeo.
 *
 * El cerebro conversacional default es CLAUDE SONNET (no DeepSeek): el flujo de
 * agendamiento exige seguir un protocolo de varios pasos y un modelo barato se
 * los salta. DeepSeek sigue disponible como tier económico EXPLÍCITO
 * (`config.modelo="deepseek"` o `AGENT_MODEL=deepseek/...`). La visión es aparte
 * (resolveVisionModel) y sí usa un modelo barato.
 */
const OPENROUTER_DEFAULT = "anthropic/claude-sonnet-4.6";
const OPENAI_DEFAULT = "gpt-5.4";
const ANTHROPIC_DEFAULT = "claude-sonnet-4-6";

/** Modelo de visión barato por proveedor (lectura de comprobantes/fotos). */
const OPENROUTER_VISION_DEFAULT = "google/gemini-2.5-flash-lite";
const OPENAI_VISION_DEFAULT = "gpt-5.4-mini";
const ANTHROPIC_VISION_DEFAULT = "claude-haiku-4-5-20251001";

export function agentRuntimeAvailable(): boolean {
  return Boolean(
    process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );
}

export function activeProvider(): "openrouter" | "openai" | "anthropic" | "none" {
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "none";
}

/** Construye el cliente del proveedor activo y resuelve el id de modelo. */
function buildModel(modelId: string): LanguageModel {
  if (process.env.OPENROUTER_API_KEY) {
    const openrouter = createOpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      name: "openrouter",
    });
    // .chat() fuerza el API de Chat Completions — OpenRouter no soporta el API
    // "responses" (default del SDK) y daría "Invalid Responses API request".
    return openrouter.chat(modelId);
  }

  if (process.env.OPENAI_API_KEY) {
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
      name: "openai",
    });
    return openai.chat(modelId);
  }

  return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelId);
}

/**
 * Modelo conversacional del agente (texto + tool-calling).
 *
 * `modelOverride` (p.ej. `CONCIERGE_MODEL`) gana sobre el `AGENT_MODEL` global:
 * permite darle al concierge un modelo más fuerte sin encarecer a la recepcionista.
 * Sin override → comportamiento actual (AGENT_MODEL → mapa → default).
 */
export function resolveAgentModel(
  configModelo: string,
  modelOverride?: string
): LanguageModel {
  const explicit =
    (modelOverride?.trim() || process.env.AGENT_MODEL?.trim()) || undefined;
  if (process.env.OPENROUTER_API_KEY) {
    return buildModel(explicit ?? OPENROUTER_MAP[configModelo] ?? OPENROUTER_DEFAULT);
  }
  if (process.env.OPENAI_API_KEY) {
    return buildModel(explicit ?? OPENAI_MAP[configModelo] ?? OPENAI_DEFAULT);
  }
  return buildModel(explicit ?? ANTHROPIC_MAP[configModelo] ?? ANTHROPIC_DEFAULT);
}

/**
 * Cadena de modelos: [principal, ...fallbacks]. Inspirado en la red de seguridad
 * de Aria (`src/lib/llm.js` FALLBACK_MODELS): si el principal falla por un error
 * a NIVEL DE MODELO (429 rate limit, 503 no disponible, 402 sin créditos…), el
 * runtime reintenta con el siguiente. Los fallbacks se configuran con
 * `AGENT_FALLBACK_MODELS` (ids del proveedor activo, separados por comas) y se
 * construyen con el MISMO proveedor activo. Sin esa env → solo el principal.
 */
export function resolveAgentModelChain(
  configModelo: string,
  modelOverride?: string
): LanguageModel[] {
  const primary = resolveAgentModel(configModelo, modelOverride);
  const raw = process.env.AGENT_FALLBACK_MODELS?.trim();
  if (!raw) return [primary];
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [primary, ...ids.map((id) => buildModel(id))];
}

/**
 * Modelo multimodal barato para las tools que leen imágenes/PDF (comprobante de
 * pago, fotos de prevaloración). Configurable con VISION_MODEL; si no, un
 * default económico con visión por proveedor.
 */
export function resolveVisionModel(): LanguageModel {
  const explicit = process.env.VISION_MODEL?.trim() || undefined;
  if (process.env.OPENROUTER_API_KEY) {
    return buildModel(explicit ?? OPENROUTER_VISION_DEFAULT);
  }
  if (process.env.OPENAI_API_KEY) {
    return buildModel(explicit ?? OPENAI_VISION_DEFAULT);
  }
  return buildModel(explicit ?? ANTHROPIC_VISION_DEFAULT);
}

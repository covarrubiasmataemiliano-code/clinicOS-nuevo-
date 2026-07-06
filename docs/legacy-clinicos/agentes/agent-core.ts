/**
 * Core del runtime de agentes IA (agnóstico de contacto/conversación).
 *
 * Expone tres utilidades reutilizables por cualquier agente de la clínica:
 *
 *  - `buildClinicFacts`      — bloque de datos vivos de la clínica (sedes,
 *                               horarios, anticipos, catálogo) leídos de la BD.
 *  - `localDateBlock`         — fecha/hora local explícita en la zona de la
 *                               clínica, con día de la semana ya resuelto.
 *  - `buildPromptFromSections`— ensambla el `system` a partir de PromptSections
 *                               del AgentConfig, ordenadas por `key`.
 *  - `runAgentTurn`           — loop de tool-use con recuperación del "muted
 *                               final turn" (bug de DeepSeek/Coco): si el modelo
 *                               termina en una tool-call sin emitir texto, fuerza
 *                               un cierre sin tools con el contexto completo.
 *
 * IMPORTANTE: este módulo NO conoce contactos, conversaciones ni burbujas de
 * WhatsApp. Solo opera sobre modelo / system / messages / tools → texto limpio.
 */
import { generateText, stepCountIs } from "ai";
import type { LanguageModel, ModelMessage, Tool } from "ai";
import type { ProviderInstance } from "@clinicos/mocks";
import { withModelFallback } from "./model-fallback";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface AgentTurnConfig {
  model: LanguageModel;
  /**
   * Modelos de respaldo (red de seguridad portada de Aria). Si el principal
   * falla por rate-limit/indisponibilidad, el turno reintenta con estos en
   * orden. Constrúyelos con `resolveAgentModelChain` (model.ts).
   */
  fallbackModels?: LanguageModel[];
  system: string;
  messages: ModelMessage[];
  tools?: Record<string, Tool>;
  /** Límite de pasos de tool-use (default: 10). */
  maxSteps?: number;
}

export interface AgentTurnToolCall {
  tool: string;
  input: unknown;
  /** false si la tool devolvió `{ ok:false }` (error capturado por hardenTools). */
  ok?: boolean;
  error?: string;
  /**
   * Output crudo que devolvió la tool — para guards post-turno que necesitan
   * distinguir RESULTADOS, no solo si corrió (p. ej. `pendienteRevision` de
   * confirmar_anticipo, Capa 5). No ampliar su uso a lógica de negocio.
   */
  output?: unknown;
}

export interface AgentTurnResult {
  /** Texto final (ya limpiado por el caller si hace falta). */
  text: string;
  /** Todos los tool-calls ejecutados durante el turno (con su resultado). */
  toolCalls: AgentTurnToolCall[];
  /** Si se tuvo que forzar el cierre por muted-final-turn. */
  closingForced: boolean;
  /** Razón de término del modelo (stop/tool-calls/length/…) — observabilidad. */
  finishReason?: string;
  /** Tokens del turno principal (no incluye el cierre forzado). */
  usage?: { inputTokens?: number; outputTokens?: number };
}

// ---------------------------------------------------------------------------
// Helpers de prompt — clinic-wide, no recepcionista-específicos
// ---------------------------------------------------------------------------

/**
 * Ensambla el bloque de `system` desde las PromptSections del AgentConfig,
 * ordenadas por `key` (orden lexicográfico) y formateadas como `## {title}\n{content}`.
 * Equivalente exacto al bloque ~L215-219 de recepcionista.ts.
 */
export function buildPromptFromSections(
  sections: { key: string; title: string; content: string }[]
): string[] {
  return sections
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((s) => `## ${s.title}\n${s.content}`);
}

/**
 * Bloque compacto de datos vivos de la clínica (de la BD, no del prompt).
 * Moved from recepcionista.ts ~L88 — no es específico de la recepcionista.
 */
export async function buildClinicFacts(
  provider: ProviderInstance["provider"]
): Promise<string> {
  const [locations, deposit, procedures] = await Promise.all([
    provider.locations.list(),
    provider.depositSettings.get(),
    provider.procedures.list(true),
  ]);
  const sede = locations.find((l) => l.isPrimary) ?? locations[0];

  let horario = "";
  if (sede) {
    const hours = await provider.locations.hours(sede.id).catch(() => null);
    if (hours) {
      const dias = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
      horario = hours.week
        .filter((d) => d.ranges.length > 0)
        .map(
          (d) =>
            `${dias[d.day] ?? d.day} ${d.ranges
              .map((r) => `${r.open}-${r.close}`)
              .join("/")}`
        )
        .join(", ");
    }
  }

  const anticipos = deposit.enabled
    ? deposit.rules
        .filter((r) => r.enabled)
        .map(
          (r) =>
            `${r.appointmentType}: $${r.amountMxn} MXN${r.isFullPayment ? " (pago completo)" : " (anticipo)"}`
        )
        .join(" · ") || "sin reglas activas"
    : "no se requieren anticipos";

  const catalogo = procedures
    .map((p) => {
      const rango =
        p.priceMinMxn || p.priceMaxMxn
          ? ` ($${p.priceMinMxn ?? "?"}–${p.priceMaxMxn ?? "?"})`
          : " (cotiza tras valoración)";
      return `${p.nombre}${rango}`;
    })
    .join("; ");

  return [
    "## DATOS VIVOS DE LA CLÍNICA (fuente de verdad — úsalos, no inventes)",
    sede
      ? `Sede: ${sede.nombre} — ${sede.direccion}${sede.ciudad ? ", " + sede.ciudad : ""}${sede.mapsUrl ? " · Maps: " + sede.mapsUrl : ""}`
      : "Sede: (sin configurar)",
    horario ? `Horario: ${horario}` : "",
    `Anticipos: ${anticipos}`,
    catalogo ? `Catálogo: ${catalogo}` : "",
    "Para precios y disponibilidad usa SIEMPRE las herramientas (consultar_catalogo, consultar_disponibilidad, consultar_anticipos).",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Fecha/hora actual EXPLÍCITA en la zona de la clínica, con el día de la semana
 * ya resuelto. Evita el bug en que, de noche en México, la hora UTC ya es el día
 * siguiente y el modelo decía "mañana es miércoles" cuando hoy es lunes.
 * Moved from recepcionista.ts ~L152.
 */
export function localDateBlock(nowIso: string, tz: string): string {
  const now = new Date(nowIso);
  const manana = new Date(now.getTime() + 24 * 3_600_000);
  const hoy = new Intl.DateTimeFormat("es-MX", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);
  const mananaFmt = new Intl.DateTimeFormat("es-MX", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(manana);
  return `Hoy es ${hoy}. Mañana es ${mananaFmt}. Usa SIEMPRE estas fechas tal cual; NUNCA calcules el día de la semana por tu cuenta. Esta conversación puede abarcar varios días: si un mensaje ANTERIOR del historial mencionó otra fecha como "hoy", IGNÓRALO — la fecha de HOY es ÚNICAMENTE la de esta línea.`;
}

// ---------------------------------------------------------------------------
// Loop de tool-use genérico
// ---------------------------------------------------------------------------

/**
 * Ejecuta un turno completo del agente: loop de tool-use + recuperación del
 * "muted final turn" (bug de DeepSeek/Coco en que el modelo termina en una
 * tool-call sin emitir texto final).
 *
 * Equivale al bloque ~L251-285 de recepcionista.ts. No conoce nada de contactos,
 * conversaciones ni burbujas — solo modelo / system / messages / tools → texto.
 */
export async function runAgentTurn(cfg: AgentTurnConfig): Promise<AgentTurnResult> {
  const { model, fallbackModels = [], system, messages, tools, maxSteps = 10 } = cfg;
  const chain = [model, ...fallbackModels];
  const logFallback = ({ from, to, err }: { from: number; to: number; err: unknown }) =>
    console.warn(
      `[agent] modelo #${from} falló (${(err as { statusCode?: number })?.statusCode ?? "?"}) — reintentando con modelo #${to}`
    );

  const result = await withModelFallback(
    chain,
    (m) =>
      generateText({
        model: m,
        system,
        messages,
        ...(tools ? { tools } : {}),
        stopWhen: stepCountIs(maxSteps),
      }),
    logFallback
  );

  let text = result.text.trim();
  let closingForced = false;

  // Algunos modelos (DeepSeek incluido) a veces terminan el turno en una
  // tool-call sin emitir texto final → el agente quedaría MUDO (el bug de Coco).
  // Si pasa, forzamos una respuesta de cierre (sin tools) con el contexto de las
  // herramientas ya ejecutadas. Y como último recurso, una frase segura: nunca
  // dejamos al paciente sin respuesta.
  if (!text) {
    closingForced = true;
    try {
      const closing = await withModelFallback(
        chain,
        (m) =>
          generateText({
            model: m,
            system,
            messages: [...messages, ...result.response.messages],
          }),
        logFallback
      );
      text = closing.text.trim();
    } catch {
      /* usamos el fallback de abajo */
    }
  }
  if (!text) {
    text = "Con gusto te ayudo. Me confirmas por favor para continuar?";
  }

  // Mapa toolCallId → output, para anotar el resultado (ok/error) de cada tool.
  // hardenTools devuelve `{ ok:false, error }` ante un fallo, así que el output
  // distingue una tool que corrió-y-falló de una que corrió bien.
  const outputs = new Map<string, unknown>();
  for (const step of result.steps) {
    for (const r of step.toolResults ?? []) {
      outputs.set(r.toolCallId, (r as { output?: unknown }).output);
    }
  }
  const toolCalls: AgentTurnToolCall[] = [];
  for (const step of result.steps) {
    for (const c of step.toolCalls ?? []) {
      const out = outputs.get(c.toolCallId);
      const failed =
        out != null &&
        typeof out === "object" &&
        (out as { ok?: unknown }).ok === false;
      toolCalls.push({
        tool: c.toolName,
        input: c.input,
        ok: !failed,
        error: failed
          ? String((out as { error?: unknown }).error ?? "")
          : undefined,
        output: out,
      });
    }
  }

  return {
    text,
    toolCalls,
    closingForced,
    finishReason: result.finishReason,
    usage: {
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    },
  };
}

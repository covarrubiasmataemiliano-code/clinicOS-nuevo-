/**
 * Registro AgentKey → factory de tools.
 *
 * Punto único de resolución entre la clave de un AgentConfig y el builder
 * que construye su ToolSet. El core genérico (`agent-core.ts`) no llama
 * ningún builder directamente — lo hace a través de este registro, lo que
 * permite añadir nuevos agentes (concierge, copiloto…) sin tocar el core.
 *
 * Etapa 2: solo existe `recepcionista` → `buildContactScopedTools`.
 * Etapa 3 añadirá el dispatch real desde el core.
 */
import type { ToolSet } from "ai";
import { buildContactScopedTools, filterTools, type ToolContext } from "./tools";
import { buildPacientesTools } from "./pacientes-tools";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Claves conocidas de agentes. Extender aquí al añadir un nuevo agente. */
export type AgentKey = "recepcionista" | "pacientes";

/**
 * Factory que construye el ToolSet para un agente dado su contexto de
 * contacto/conversación y la lista de tools habilitadas.
 */
export type AgentToolsFactory = (ctx: ToolContext) => ToolSet;

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

/**
 * Mapa AgentKey → factory de tools.
 *
 * Convención: cada factory aplica `filterTools(all, ctx.enabledTools)` antes
 * de devolver — el filtrado por clínica es responsabilidad del factory, no
 * del caller.
 *
 * El tipo `Partial<Record<AgentKey, AgentToolsFactory>>` permite agregar
 * entradas incrementalmente sin obligar a implementar todos los agentes a la
 * vez; el caller debe manejar el caso en que la clave no esté registrada.
 */
export const agentRegistry: Partial<Record<AgentKey, AgentToolsFactory>> = {
  recepcionista: (ctx) => buildContactScopedTools(ctx),
  pacientes: (ctx) => buildPacientesTools(ctx),
};

/**
 * Resuelve el factory de tools para un agente dado su key.
 * Devuelve `undefined` si la clave no está registrada (agente desconocido o
 * aún no implementado).
 */
export function resolveAgentTools(
  key: string,
  ctx: ToolContext
): ToolSet | undefined {
  const factory = agentRegistry[key as AgentKey];
  return factory ? factory(ctx) : undefined;
}

// Re-exportar filterTools para que los callers del registro no necesiten
// importar desde tools.ts directamente.
export { filterTools };

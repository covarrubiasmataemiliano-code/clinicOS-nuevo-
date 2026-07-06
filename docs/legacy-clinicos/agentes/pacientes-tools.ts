/**
 * Toolset del agente de pacientes.
 *
 * Reutiliza TODO el toolset contact-scoped del recepcionista (expediente, citas,
 * escalación, notificar al doctor…) y le suma dos tools propias del journey:
 *  - `enviar_ficha`            — devuelve la ficha de cuidado APROBADA por el
 *                                doctor (lo normal por etapa, cuidados, prep,
 *                                banderas rojas). Es la fuente de grounding del
 *                                alcance seguro: el agente solo afirma lo que
 *                                esté aquí (o en el expediente); si no, escala.
 *  - `mover_etapa_procedimiento` — avanza la etapa del journey emitiendo
 *                                `procedimiento_etapa_cambiada` (refs.appointmentId
 *                                + payload.etapa), que la proyección folda.
 *
 * El subconjunto realmente expuesto lo decide `enabledTools` del AgentConfig de
 * pacientes (filtro final) — p.ej. NO habilitamos tools de venta de leads.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { JourneyStageSchema } from "@clinicos/contracts";
import {
  buildContactScopedTools,
  filterTools,
  type ToolContext,
} from "./tools";

/** Tools propias del journey del paciente (scoped al contacto). */
function buildPacienteExtraTools({ instance, contactId }: ToolContext): ToolSet {
  const { provider } = instance;

  return {
    enviar_ficha: tool({
      description:
        "Consulta la ficha de cuidado APROBADA por el doctor para el procedimiento de ESTE paciente (lo normal por etapa, cuidados, preparación y banderas rojas). Úsala antes de responder una duda clínica: solo puedes afirmar/tranquilizar con lo que devuelva esta ficha (o el expediente). Si lo que describe el paciente NO está en 'normalesEnEstaEtapa' o coincide con una bandera roja, NO lo resuelvas: escala. Nunca inventes indicaciones médicas.",
      inputSchema: z.object({
        etapa: JourneyStageSchema.optional().describe(
          "Etapa del journey a consultar; por defecto la etapa actual del procedimiento."
        ),
        appointmentId: z
          .string()
          .optional()
          .describe(
            "Cita ancla del procedimiento a consultar. Úsalo cuando el paciente tenga MÁS DE UN procedimiento activo (la tool te lo avisa); así no mezclas protocolos."
          ),
      }),
      execute: async ({ etapa, appointmentId }) => {
        const procs = await provider.patientProcedures.listForContact(contactId);
        const activos = procs.filter((p) => p.status === "activo");
        let activo;
        if (appointmentId) {
          activo = procs.find((p) => p.appointmentId === appointmentId);
        } else if (activos.length > 1) {
          // Más de un procedimiento activo y sin especificar cuál: NO adivines.
          return {
            ok: true as const,
            ambiguo: true,
            procedimientos: activos.map((p) => ({
              appointmentId: p.appointmentId,
              nombre: p.nombre,
              tipo: p.tipo,
              etapa: p.etapa,
            })),
            nota: "El paciente tiene más de un procedimiento activo. Pregúntale de cuál se trata y vuelve a llamar enviar_ficha con su appointmentId; NUNCA mezcles los protocolos de dos procedimientos.",
          };
        } else {
          activo = activos[0] ?? procs[0];
        }
        if (!activo)
          return {
            ok: false as const,
            error: "El paciente no tiene un procedimiento registrado.",
          };
        const catalogo = activo.procedureId
          ? await provider.procedures.list(false)
          : [];
        const proc = catalogo.find((p) => p.id === activo.procedureId);
        const et = etapa ?? activo.etapa;
        if (!proc?.ficha)
          return {
            ok: true as const,
            procedimiento: activo.nombre,
            tipo: activo.tipo,
            etapa: et,
            ficha: null,
            nota: "No hay ficha aprobada para este procedimiento. Responde SOLO logística; ante cualquier duda clínica, escala al doctor.",
          };
        const ficha = proc.ficha;
        const normales =
          ficha.normalesPorEtapa.find((n) => n.etapa === et)?.normales ?? [];
        return {
          ok: true as const,
          procedimiento: activo.nombre,
          tipo: activo.tipo,
          etapa: et,
          diasDesde: activo.diasDesde,
          ficha: {
            normalesEnEstaEtapa: normales,
            cuidados: ficha.cuidados,
            preparacion: ficha.preparacion,
            banderasRojas: ficha.banderasRojas,
          },
          nota: "Relaya SOLO lo que está aquí, atribuyéndolo al doctor ('según tu plan de cuidado…'). Si el paciente describe algo fuera de 'normalesEnEstaEtapa' o que coincide con una bandera roja, escala (urgente si la bandera lo marca).",
        };
      },
    }),

    mover_etapa_procedimiento: tool({
      description:
        "Cambia la etapa del journey del procedimiento del paciente (preparacion → cuidado → seguimiento → mantenimiento). Úsalo cuando el contexto lo amerite (p.ej. el paciente confirma que ya pasó su ventana de recuperación). No lo uses para diagnosticar.",
      inputSchema: z.object({
        etapa: JourneyStageSchema,
        appointmentId: z
          .string()
          .optional()
          .describe(
            "Cita ancla del procedimiento a mover; por defecto el procedimiento activo del paciente."
          ),
      }),
      execute: async ({ etapa, appointmentId }) => {
        const procs = await provider.patientProcedures.listForContact(contactId);
        // Solo se mueve un procedimiento ACTIVO: si el ancla está cancelada o
        // no_show, la proyección ignoraría el cambio → no reclames un no-op.
        const target = appointmentId
          ? procs.find(
              (p) => p.appointmentId === appointmentId && p.status === "activo"
            )
          : procs.find((p) => p.status === "activo");
        if (!target)
          return {
            ok: false as const,
            error:
              "No hay un procedimiento ACTIVO del paciente para cambiar de etapa (¿cancelado o inexistente?).",
          };
        await provider.events.emit({
          type: "procedimiento_etapa_cambiada",
          refs: {
            appointmentId: target.appointmentId,
            contactId,
            procedureId: target.procedureId,
          },
          payload: { etapa },
          actor: instance.db.actor(),
        });
        return { ok: true as const, procedimiento: target.nombre, etapa };
      },
    }),
  };
}

/**
 * ToolSet del agente de pacientes = toolset contact-scoped del recepcionista
 * (sin filtrar) + tools del journey, filtrado al final por `enabledTools` del
 * AgentConfig de pacientes.
 */
export function buildPacientesTools(ctx: ToolContext): ToolSet {
  const base = buildContactScopedTools({ ...ctx, enabledTools: undefined });
  const extra = buildPacienteExtraTools(ctx);
  return filterTools({ ...base, ...extra }, ctx.enabledTools);
}

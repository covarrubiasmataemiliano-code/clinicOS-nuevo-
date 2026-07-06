/**
 * Tools de consulta sin estado de contacto.
 *
 * Estas herramientas solo leen datos de la clínica (catálogo, sedes,
 * disponibilidad de calendario) y no dependen de ningún contacto ni
 * conversación concretos. Por eso pueden ser reutilizadas por cualquier
 * agente (recepcionista, concierge, copiloto…) sin necesidad de instanciar
 * el builder completo con un contactId.
 *
 * IMPORTANTE: si en el futuro alguna de estas tools necesita escribir
 * estado (p.ej. log por contacto), muévela de vuelta a tools.ts dentro de
 * buildContactScopedTools, donde el contactId está disponible.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ProviderInstance } from "@clinicos/mocks";
import { getAccessTokenFor } from "../google-sync";
import { isFree, freeBusyRanges, listEventsRange } from "./google-calendar";

// ---------------------------------------------------------------------------
// Tipo auxiliar para los builders de tools compartidas
// ---------------------------------------------------------------------------

export interface SharedToolDeps {
  instance: ProviderInstance;
}

// ---------------------------------------------------------------------------
// Builders individuales de tools contact-independientes
// ---------------------------------------------------------------------------

/**
 * Consulta el catálogo de procedimientos/servicios activos.
 * Solo lee `provider.procedures` — ninguna dependencia de contacto.
 */
export function makeConsultarCatalogo({ instance }: SharedToolDeps) {
  return tool({
    description:
      "Consulta el catálogo de procedimientos/servicios activos de la clínica con rangos de precio y notas. Úsalo SIEMPRE antes de dar precios — nunca inventes montos.",
    inputSchema: z.object({}),
    execute: async () => {
      const procedures = await instance.provider.procedures.list(true);
      return procedures.map((p) => ({
        nombre: p.nombre,
        precioDesdeMxn: p.priceMinMxn,
        precioHastaMxn: p.priceMaxMxn,
        notas: p.notasVenta,
      }));
    },
  });
}

/**
 * Devuelve la dirección y link de Google Maps de la sede primaria.
 * Solo lee `provider.locations` — ninguna dependencia de contacto.
 */
export function makeEnviarUbicacion({ instance }: SharedToolDeps) {
  return tool({
    description:
      "Devuelve la dirección y el link de Google Maps de la sede para compartirlos con el paciente. Úsalo al confirmar una cita presencial o si preguntan dónde están.",
    inputSchema: z.object({}),
    execute: async () => {
      const locations = await instance.provider.locations.list();
      const sede = locations.find((l) => l.isPrimary) ?? locations[0];
      if (!sede) return { error: "La clínica no tiene sede configurada" };
      return {
        nombre: sede.nombre,
        direccion: sede.direccion,
        ciudad: sede.ciudad,
        mapsUrl: sede.mapsUrl,
      };
    },
  });
}

/**
 * Consulta slots disponibles para una fecha, cruzados con Google Calendar.
 * Solo lee datos de sede/agenda/calendar — ninguna dependencia de contacto.
 */
export function makeConsultarDisponibilidad({ instance }: SharedToolDeps) {
  const cid = () => instance.db.clinicId();
  return tool({
    description:
      "Consulta horarios disponibles para una fecha (YYYY-MM-DD). Devuelve hasta 2 opciones reales, ya cruzadas con el calendario del doctor en vivo. Ofrece máximo dos, nunca toda la agenda.",
    inputSchema: z.object({
      fecha: z.string().describe("Fecha a consultar, formato YYYY-MM-DD"),
    }),
    execute: async ({ fecha }) => {
      const locations = await instance.provider.locations.list();
      const sede = locations.find((l) => l.isPrimary) ?? locations[0];
      if (!sede) return { error: "La clínica no tiene sedes configuradas" };
      // Resuelve el doctor de la clínica para usar su horario (DoctorSchedule:
      // sin mañanas, slot de 40 min, etc.). Con exactamente un doctor activo su
      // horario manda; con varios o ninguno se omite y availability cae al
      // horario de la sede (retrocompatible).
      const doctores = (await instance.provider.users.list()).filter(
        (u) => u.rol === "doctor" && u.activo
      );
      const doctorId = doctores.length === 1 ? doctores[0]!.id : undefined;
      const settings = await instance.provider.settings.get();
      const tz = settings.timezone || "America/Mexico_City";
      const token = await getAccessTokenFor(instance.db, cid()).catch(() => null);
      const conn = instance.db.state.googleCalendarConnections.find(
        (c) => c.clinicId === cid()
      );
      const fmt = new Intl.DateTimeFormat("es-MX", {
        timeZone: tz,
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      // Modo por-cliente. "lookahead" (oranza): una llamada freeBusy + avanza al
      // próximo día con hueco. Default (becerril): chequeo por-slot del día pedido.
      if (process.env.AVAILABILITY_LOOKAHEAD_MODE === "lookahead") {
        const LOOKAHEAD_DAYS = 10;
        let busy: { start: string; end: string }[] = [];
        if (token && conn) {
          const winMin = `${fecha}T00:00:00.000Z`;
          const winMax = new Date(
            new Date(winMin).getTime() + (LOOKAHEAD_DAYS + 2) * 86_400_000
          ).toISOString();
          busy = await freeBusyRanges(
            token,
            conn.calendarId,
            winMin,
            winMax
          ).catch(() => []);
        }
        const now = Date.now();
        const slotLibre = (s: { startsAt: string; endsAt: string }) => {
          if (new Date(s.startsAt).getTime() <= now) return false;
          if (!token || !conn) return true;
          const a = new Date(s.startsAt).getTime();
          const b = new Date(s.endsAt).getTime();
          return !busy.some(
            (x) =>
              new Date(x.start).getTime() < b && new Date(x.end).getTime() > a
          );
        };
        let elegida = fecha;
        let libres: { startsAt: string; endsAt: string }[] = [];
        for (let i = 0; i <= LOOKAHEAD_DAYS; i++) {
          const d = new Date(
            new Date(`${fecha}T12:00:00.000Z`).getTime() + i * 86_400_000
          )
            .toISOString()
            .slice(0, 10);
          const raw = await instance.provider.appointments.availability(
            sede.id,
            d,
            doctorId
          );
          const free = raw.filter(slotLibre);
          if (free.length > 0) {
            elegida = d;
            libres = free;
            break;
          }
        }
        const opciones = libres.slice(0, 2).map((s) => ({
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          cuando: fmt.format(new Date(s.startsAt)),
        }));
        const esOtraFecha = opciones.length > 0 && elegida !== fecha;
        return {
          sede: sede.nombre,
          locationId: sede.id,
          fechaPedida: fecha,
          fecha: opciones.length > 0 ? elegida : fecha,
          esOtraFecha,
          opciones,
          nota:
            opciones.length === 0
              ? `No hay NINGÚN hueco real en los próximos ${LOOKAHEAD_DAYS} días. No inventes horas: dile con tacto que por ahora está lleno y ofrece avisarle en cuanto se libere.`
              : esOtraFecha
                ? "ESTAS son las ÚNICAS opciones reales; la fecha pedida estaba LLENA: son del PRÓXIMO día con hueco. Ofrécele EXACTAMENTE estas (usa 'cuando'). PROHIBIDO inventar otras o decir que no hay nada."
                : "ESTAS son las ÚNICAS opciones reales y VIGENTES. Ofrécelas TAL CUAL usando 'cuando'. IGNORA cualquier horario distinto dicho antes. Para agendar usa startsAt y endsAt.",
        };
      }

      // Default (becerril): chequeo por-slot del día pedido.
      let slots = await instance.provider.appointments.availability(
        sede.id,
        fecha,
        doctorId
      );
      if (token && conn) {
        const checked = await Promise.all(
          slots.map(async (s) => ({
            s,
            free: await isFree(
              token,
              conn.calendarId,
              s.startsAt,
              s.endsAt
            ).catch(() => true),
          }))
        );
        slots = checked.filter((x) => x.free).map((x) => x.s);

        // Modelo de SALA COMPARTIDA (becerril): además del calendario propio del
        // Dr., resta la ocupación de la sala (citas de los OTROS doctores) salvo
        // los holds reservados — eventos titulados como holdTitle (p. ej. "Male")
        // que marcan espacio del propio Dr. y SÍ son ofrecibles. Config por
        // cliente: campo `sharedRoomCalendarId` de la conexión o, en su defecto,
        // `SHARED_ROOM_CALENDAR_ID` en env. Sin sala configurada = sin efecto.
        const sharedRoom =
          conn.sharedRoomCalendarId || process.env.SHARED_ROOM_CALENDAR_ID;
        if (sharedRoom && slots.length > 0) {
          const holdTitle = (
            conn.holdTitle ||
            process.env.CALENDAR_HOLD_TITLE ||
            "Male"
          )
            .trim()
            .toLowerCase();
          const winMin = `${fecha}T00:00:00.000Z`;
          const winMax = new Date(
            new Date(winMin).getTime() + 36 * 3600_000
          ).toISOString();
          const roomEvents = await listEventsRange(
            token,
            sharedRoom,
            winMin,
            winMax
          ).catch(() => []);
          const ocupados = roomEvents.filter(
            (e) => !e.allDay && e.title.trim().toLowerCase() !== holdTitle
          );
          slots = slots.filter(
            (s) =>
              !ocupados.some(
                (e) =>
                  new Date(e.startsAt).getTime() <
                    new Date(s.endsAt).getTime() &&
                  new Date(e.endsAt).getTime() > new Date(s.startsAt).getTime()
              )
          );
        }
      }
      return {
        sede: sede.nombre,
        locationId: sede.id,
        opciones: slots.slice(0, 2).map((s) => ({
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          cuando: fmt.format(new Date(s.startsAt)),
        })),
        nota: "Dile al paciente la hora tal como viene en 'cuando' (hora local). Para crear/agendar usa startsAt y endsAt.",
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Convenience: las tres juntas como ToolSet parcial
// ---------------------------------------------------------------------------

/**
 * Devuelve el subconjunto de tools de consulta (contact-independientes) como
 * ToolSet, listo para fusionar con el conjunto contact-scoped de cualquier
 * agente o para ser ofrecidas por sí solas a un agente de solo lectura.
 */
export function buildSharedQueryTools(deps: SharedToolDeps): ToolSet {
  return {
    consultar_catalogo: makeConsultarCatalogo(deps),
    enviar_ubicacion: makeEnviarUbicacion(deps),
    consultar_disponibilidad: makeConsultarDisponibilidad(deps),
  };
}

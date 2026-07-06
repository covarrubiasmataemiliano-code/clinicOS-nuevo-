/**
 * Toolset del concierge — clinic-scoped (NO contact-locked).
 *
 * El concierge es la interfaz directa entre el doctor/auxiliar y ClinicOS: tiene
 * VISIÓN TRANSVERSAL de toda la operación (agenda, CRM/expedientes, bandeja de
 * WhatsApp, escalaciones, pagos, finanzas) y puede ejecutar acciones. A
 * diferencia de `tools.ts` (recepcionista, amarrado a un contacto), estas tools
 * operan sobre toda la clínica.
 *
 * Cada tool lleva su TIER del modelo de 3 tiers como comportamiento:
 *  - 🟢 auto: lecturas + escrituras operativas/WhatsApp → se ejecutan en el
 *    turno vía el provider; las escrituras se registran en `sink`.
 *  - 🟡 confirma: dinero → NO se ejecuta; registra una PROPUESTA en `sink` que
 *    el doctor confirma luego (`concierge.confirmAction`).
 *
 * El RBAC se aplica por construcción: una tool solo se monta si el usuario tiene
 * la capacidad correspondiente.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  AppointmentTypeSchema,
  ExpenseCategorySchema,
  LeadClassificationValueSchema,
  PaymentConceptSchema,
  PaymentMethodSchema,
  type ConciergeCapability,
} from "@clinicos/contracts";
import type { ProviderInstance, ConciergeProposedAction } from "@clinicos/mocks";
import {
  makeConsultarCatalogo,
  makeConsultarDisponibilidad,
} from "./shared-tools";
import { APP_MAP, appMapTree } from "./app-map";
import { retrieveEntityKnowledge, DB_MANDA_RULE, TOPK_S3_EXPEDIENTE } from "../memory";
import { fetchWaMediaBytes } from "../media";
import { getAccessTokenFor } from "../google-sync";
import { listEventsRange } from "./google-calendar";
import { classifyRoomEvents } from "./room-agenda";

/** Tope para capturar una imagen como Asset (evita 3 copias en RAM). 15 MB. */
const MAX_ASSET_BYTES = 15_000_000;

/** Detecta el MIME de imagen por magic bytes (jpeg/png/webp). Default jpeg. */
function sniffImageMime(b: Uint8Array): string {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return "image/webp";
  return "image/jpeg";
}

export interface ConciergeToolDeps {
  instance: ProviderInstance;
  /** Zona horaria IANA de la clínica (para construir rangos y formatear horas). */
  tz: string;
  /** Capacidades efectivas del usuario (RBAC ya resuelto). */
  capabilities: ConciergeCapability[];
  /** Acciones recolectadas durante el turno (auto ejecutadas / confirma propuestas). */
  sink: ConciergeProposedAction[];
  /**
   * Imágenes (assets) que una tool surfó este turno para MOSTRAR al doctor. El
   * caller (`conciergeReply`) las anexa como `![desc](asset:<id>)` si el modelo
   * no las incrustó — así el render no depende de que el LLM emita el markdown.
   */
  shownAssets?: { id: string; desc?: string }[];
}

/** Offset numérico ("-06:00" / "-07:00") de una zona IANA en una fecha dada. */
function tzOffset(tz: string, dateYmd: string): string {
  try {
    const d = new Date(`${dateYmd}T12:00:00Z`);
    const s = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).format(d);
    const m = /GMT([+-]\d{2}:\d{2})/.exec(s);
    return m?.[1] ?? "-06:00";
  } catch {
    return "-06:00";
  }
}

/** "9:30 a.m." en la zona de la clínica. */
function fmtHour(tz: string, iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Contrato de resiliencia: envuelve el `execute` de CADA tool para que NUNCA
 * lance. Una excepción del provider (id inválido, validación Zod, conflicto de
 * estado, "no encontrado") se convierte en `{ ok: false, error }` → el modelo
 * recibe un error claro que puede explicar o reintentar, en vez de que la
 * excepción reviente el turno (`generateText`) y el agente se quede mudo / "se
 * rinda". Es la base del harness: un modelo modesto deja de rendirse.
 */
function hardenTools(tools: ToolSet): ToolSet {
  for (const name of Object.keys(tools)) {
    const t = tools[name] as {
      execute?: (...args: unknown[]) => Promise<unknown>;
    };
    const orig = t.execute;
    if (typeof orig !== "function") continue;
    t.execute = async (...args) => {
      try {
        return await orig(...args);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.warn(`[concierge] tool ${name} falló: ${error}`);
        return {
          ok: false,
          error,
          nota: "La acción no se completó. Explícale al usuario qué pasó con claridad y ofrece una alternativa o pídele el dato que falte; NO lo declares como hecho.",
        };
      }
    };
  }
  return tools;
}

export function buildConciergeTools(deps: ConciergeToolDeps): ToolSet {
  const { instance, tz, capabilities, sink, shownAssets } = deps;
  const { provider, db } = instance;
  const has = (c: ConciergeCapability) => capabilities.includes(c);
  const tools: ToolSet = {};

  const nowIso = () => db.now();
  /** Fecha de hoy (YYYY-MM-DD) en la zona de la clínica. */
  const todayYmd = () =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(nowIso()));
  const addDays = (ymd: string, n: number) => {
    const d = new Date(`${ymd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dayRange = (ymd: string) => {
    const off = tzOffset(tz, ymd);
    return { from: `${ymd}T00:00:00${off}`, to: `${ymd}T23:59:59${off}` };
  };
  /** Mapa contactId → nombre (una sola lectura, reusable). */
  const nameMap = async () => {
    const cs = await provider.contacts.list();
    return new Map(cs.map((c) => [c.id, c.nombre]));
  };

  // ── 🟢 Lectura — conocimiento transversal (capability: leer) ──────────────
  if (has("leer")) {
    tools.consultar_catalogo = makeConsultarCatalogo({ instance });
    tools.consultar_disponibilidad = makeConsultarDisponibilidad({ instance });

    tools.guia_app = tool({
      description:
        "Mapa de la plataforma ClinicOS: módulos, rutas y qué se hace en cada uno. Úsalo cuando pregunten DÓNDE hacer algo en la app ('¿dónde registro un pago?', '¿cómo llego a la agenda?', 'guíame para cotizar') y guía paso a paso con la ruta.",
      inputSchema: z.object({
        tema: z
          .string()
          .optional()
          .describe("Qué quiere hacer el usuario; opcional"),
      }),
      execute: async () => ({
        arbol: appMapTree(),
        modulos: APP_MAP,
        nota: "Indícale la ruta (ej. /finanzas) y los pasos. Si está en su celular, dile el nombre del módulo en el menú.",
      }),
    });

    tools.ver_archivos_paciente = tool({
      description:
        "Archivos y medios (assets) de un paciente: las FOTOS que mandó por WhatsApp, notas de voz, estudios, tickets, PDFs. Úsalo cuando el doctor pida VER o mostrar una foto/imagen/archivo/audio de un paciente, o pregunte '¿qué me mandó?'. SÍ puedes mostrarle una imagen: inclúyela en tu respuesta como markdown ![descripción](asset:<id>) con el id del asset. Para otros archivos da el enlace [nombre](asset:<id>).",
      inputSchema: z.object({
        pacienteContactId: z
          .string()
          .describe("id del contacto (cont_...) cuyos archivos quieres ver"),
        soloImagenes: z
          .boolean()
          .optional()
          .describe("Si true, solo fotos/imágenes"),
      }),
      execute: async ({ pacienteContactId, soloImagenes }) => {
        const assets = await provider.assets.list({
          contactId: pacienteContactId,
          ...(soloImagenes ? { kind: "image" as const } : {}),
          limit: 20,
        });
        if (assets.length === 0) {
          return {
            encontrados: 0,
            nota: "Este paciente no tiene archivos ni medios guardados.",
          };
        }
        // Captura las imágenes para que el caller las muestre de forma
        // determinista (el modelo no siempre incrusta el markdown). Cap a 6.
        if (shownAssets) {
          for (const a of assets.filter((x) => x.kind === "image").slice(0, 6)) {
            shownAssets.push({
              id: a.id,
              desc: a.ingest?.description ?? a.nombre ?? "Foto del paciente",
            });
          }
        }
        return {
          encontrados: assets.length,
          archivos: assets.map((a) => ({
            id: a.id,
            tipo: a.kind,
            categoria: a.category,
            nombre: a.nombre,
            cuando: fmtHour(tz, a.createdAt),
            descripcion:
              a.ingest?.description ??
              a.ingest?.transcript ??
              a.ingest?.ocrText,
          })),
          nota: "Para MOSTRAR una imagen al doctor inclúyela como ![descripción](asset:<id>); para otros archivos usa [nombre](asset:<id>). Usa el id del asset tal cual.",
        };
      },
    });

    tools.ver_historial_eventos = tool({
      description:
        "Línea de tiempo de HECHOS (ledger de eventos) de un paciente: leads, citas, pagos, mensajes, documentos, en orden cronológico. Úsalo para '¿qué ha pasado con X?' o 'dame el historial de movimientos de X'. Complementa consultar_expediente con la secuencia exacta.",
      inputSchema: z.object({
        pacienteContactId: z.string().describe("id del contacto (cont_...)"),
        limite: z
          .number()
          .optional()
          .describe("Máximo de eventos (default 30)"),
      }),
      execute: async ({ pacienteContactId, limite }) => {
        const eventos = await provider.events.list({
          contactId: pacienteContactId,
          limit: limite ?? 30,
        });
        const fmt = new Intl.DateTimeFormat("es-MX", {
          timeZone: tz,
          dateStyle: "short",
          timeStyle: "short",
        });
        return {
          encontrados: eventos.length,
          eventos: eventos.map((e) => ({
            tipo: e.type,
            cuando: fmt.format(new Date(e.occurredAt)),
            quien: e.actor?.kind,
            detalle: e.payload,
          })),
        };
      },
    });

    tools.resumen_clinica = tool({
      description:
        "Panorama general de la clínica HOY: cuántos leads/pacientes, citas de hoy, pendientes por confirmar, escalaciones, conversaciones sin leer y números financieros. Úsalo cuando te pregunten algo general ('cómo va la clínica', 'el CRM', 'qué hay hoy') — NO pidas un punto de partida, llama esto.",
      inputSchema: z.object({}),
      execute: async () => {
        const hoy = todayYmd();
        const [contactos, citasHoy, escalaciones, convs, dash] =
          await Promise.all([
            provider.contacts.list(),
            provider.appointments.list(dayRange(hoy)),
            provider.escalations.list(true),
            provider.conversations.list(),
            provider.financialReports.dashboard().catch(() => null),
          ]);
        const pacientes = contactos.filter((c) => c.tipo === "paciente").length;
        const leads = contactos.filter((c) => c.tipo === "lead").length;
        const sinLeer = convs.reduce((n, c) => n + (c.unreadCount || 0), 0);
        const enHumano = convs.filter((c) => c.iaState === "humano").length;
        const citasActivas = citasHoy.filter((a) => a.estado !== "cancelada");
        const porConfirmar = citasHoy.filter(
          (a) => a.estado === "nueva"
        ).length;
        return {
          fecha: hoy,
          contactos: { total: contactos.length, pacientes, leads },
          citasHoy: {
            total: citasActivas.length,
            porConfirmar,
            canceladas: citasHoy.length - citasActivas.length,
          },
          pendientes: {
            escalaciones: escalaciones.length,
            conversacionesSinLeer: sinLeer,
            conversacionesEnHumano: enHumano,
          },
          finanzas: dash
            ? {
                ingresosMxn: dash.kpis.ingresosMxn,
                gastosMxn: dash.kpis.gastosMxn,
                utilidadMxn: dash.kpis.utilidadMxn,
                anticiposPendientesMxn: dash.kpis.anticiposPendientesMxn,
              }
            : null,
        };
      },
    });

    tools.buscar_paciente = tool({
      description:
        "Busca contactos (lead o paciente) por nombre o teléfono. Si NO das query, devuelve los contactos más recientes (útil para '¿qué pacientes tengo?'). Para el detalle completo de uno, usa consultar_expediente con su id.",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("Nombre parcial o teléfono; vacío = lista reciente"),
      }),
      execute: async ({ query }) => {
        const contacts = await provider.contacts.list(
          query ? { busqueda: query } : undefined
        );
        return {
          encontrados: contacts.length,
          contactos: contacts.slice(0, 12).map((c) => ({
            id: c.id,
            nombre: c.nombre,
            tipo: c.tipo,
            telefono: c.whatsappPhone,
            clasificacion: c.leadClassification,
            ciudad: c.ciudad,
            expedienteId: c.patientRecordId,
          })),
        };
      },
    });

    tools.consultar_expediente = tool({
      description:
        "Ficha COMPLETA de un contacto por su id (cont_): datos, clasificación, sus citas, sus pagos y su historial. Úsalo para resolver el paciente detrás de una cita (el pacienteContactId de ver_agenda) o tras buscar_paciente.",
      inputSchema: z.object({
        contactId: z.string().describe("id del contacto (cont_)"),
      }),
      execute: async ({ contactId }) => {
        const ctx = await provider.contacts.getContext(contactId);
        // patient_profile (agentic-ERP): proyección 360 ya agregada. Si aún no
        // existe, se proyecta al vuelo. Le da a Sherlock métricas + señales
        // cross-departamento sin reconstruirlas a mano.
        const perfilRaw =
          (await provider.profiles.get("patient", contactId)) ??
          (await provider.profiles.reproject("patient", contactId));
        const perfil =
          perfilRaw && perfilRaw.entityType === "patient"
            ? {
                resumen: perfilRaw.resumen,
                metricas: perfilRaw.metrics,
                señales: perfilRaw.signals,
              }
            : undefined;
        // Conocimiento por-entidad (RAG): lo aprendido de sus assets (notas de
        // voz, fotos) y los resúmenes de consulta del Copiloto. Best-effort; []
        // si no hay memoria configurada. La query incluye términos clínicos —
        // no solo el nombre — para que el embedding case con el texto clínico
        // indexado (un nombre solo embebe mal contra "diagnóstico/tratamiento").
        const clinicId = db.state.session?.clinicId;
        const conocimiento = clinicId
          ? await retrieveEntityKnowledge(
              clinicId,
              "patient",
              contactId,
              `${ctx.contact.nombre}: resumen de consulta, diagnóstico, tratamiento, pendientes y antecedentes`,
              TOPK_S3_EXPEDIENTE
            ).catch((err) => {
              console.warn(
                `[memory] retrieveEntityKnowledge falló en consultar_expediente (contacto=${contactId}):`,
                err
              );
              return [];
            })
          : [];
        return {
          contacto: {
            id: ctx.contact.id,
            nombre: ctx.contact.nombre,
            tipo: ctx.contact.tipo,
            telefono: ctx.contact.whatsappPhone,
            email: ctx.contact.email,
            ciudad: ctx.contact.ciudad,
            clasificacion: ctx.contact.leadClassification,
          },
          perfil,
          // Regla de Oro ("la BD manda"): si hay conocimiento RAG, va etiquetado
          // como referencia subordinada a la BD/tools (fuente única DB_MANDA_RULE,
          // T1.1b). Sin items no hay nada que proteger → se mantiene [].
          conocimiento: conocimiento.length
            ? { regla: DB_MANDA_RULE, items: conocimiento }
            : conocimiento,
          tieneExpediente: Boolean(ctx.record),
          citas: ctx.appointments.map((a) => ({
            id: a.id,
            cuando: fmtHour(tz, a.startsAt),
            fechaIso: a.startsAt,
            tipo: a.tipo,
            estado: a.estado,
            motivo: a.motivo,
          })),
          pagos: ctx.payments.map((p) => ({
            concepto: p.concepto,
            montoMxn: p.amountMxn,
            estado: p.status,
          })),
          historialReciente: ctx.timeline.slice(-6),
        };
      },
    });

    tools.ver_agenda = tool({
      description:
        "Citas de un día CON el nombre del paciente y la hora local ya formateada. Sin fecha = hoy. Acepta YYYY-MM-DD. Para el detalle de un paciente usa su pacienteContactId con consultar_expediente. En consultorio compartido, algunas citas traen fuente:'sala' (vienen del calendario de la sala compartida, SOLO LECTURA — no se editan/cancelan aquí) y puede venir 'salaOcupada' = bloques de OTROS doctores (sin datos del paciente). NO digas 'no hay citas' si hay citas de sala.",
      inputSchema: z.object({
        fecha: z
          .string()
          .optional()
          .describe("YYYY-MM-DD; vacío = hoy"),
      }),
      execute: async ({ fecha }) => {
        const ymd = fecha || todayYmd();
        const rango = dayRange(ymd);
        const [citasRaw, nombres] = await Promise.all([
          provider.appointments.list(rango),
          nameMap(),
        ]);
        const citas = citasRaw.map((a) => {
          const esBloqueo = a.tipo === "bloqueo";
          return {
            id: a.id,
            hora: fmtHour(tz, a.startsAt),
            // Un bloqueo no tiene paciente: su etiqueta es el título/motivo.
            paciente: esBloqueo
              ? `🔒 ${a.titulo || a.motivo || "Horario bloqueado"}`
              : (a.patientContactId && nombres.get(a.patientContactId)) ??
                "(desconocido)",
            pacienteContactId: a.patientContactId,
            esBloqueo,
            tipo: a.tipo,
            estado: a.estado,
            motivo: a.motivo,
            fuente: "clinicos" as const,
            // Evento importado de Google sin paciente claro: el doctor debe
            // ligarlo/completarlo. El concierge puede avisarlo y proponer match.
            porRevisar: a.needsReview || undefined,
            motivoRevision: a.reviewReason,
          };
        });

        // ── Sala compartida (consultorio multi-doctor, ej. becerril/AP-Tux) ──
        // Las citas REALES del doctor pueden vivir en el calendario de la sala,
        // que NO se sincroniza a `appointments`. Si está configurado
        // (`sharedRoomCalendarId` + `doctorColorIds`), lo leemos en vivo
        // (read-only) y clasificamos por color PHI-safe: las de ESTE doctor se
        // muestran como citas; las de OTROS solo como "ocupado" (sin sus datos).
        type SalaCita = {
          id: string;
          hora: string;
          paciente: string;
          esApartado: boolean;
          fuente: "sala";
          soloLectura: true;
        };
        type SalaOcupada = { hora: string; fin: string; estado: string };
        const salaCitas: SalaCita[] = [];
        const salaOcupada: SalaOcupada[] = [];
        const conn = db.state.googleCalendarConnections.find(
          (c) => c.clinicId === db.clinicId()
        );
        if (conn?.sharedRoomCalendarId && (conn.doctorColorIds?.length ?? 0) > 0) {
          const token = await getAccessTokenFor(db, db.clinicId()).catch(
            () => null
          );
          if (token) {
            const evs = await listEventsRange(
              token,
              conn.sharedRoomCalendarId,
              rango.from,
              rango.to
            ).catch(() => []);
            const clasificados = classifyRoomEvents(
              evs.map((e) => ({
                title: e.title,
                startsAt: e.startsAt,
                endsAt: e.endsAt,
                allDay: e.allDay,
                colorId: e.colorId,
              })),
              {
                doctorColorIds: conn.doctorColorIds ?? [],
                holdTitle: conn.holdTitle,
              }
            );
            clasificados.forEach((ev, i) => {
              if (ev.clase === "otro") {
                // PHI: paciente de OTRO doctor → solo horario, sin título.
                salaOcupada.push({
                  hora: fmtHour(tz, ev.startsAt),
                  fin: fmtHour(tz, ev.endsAt),
                  estado: "ocupado (otro doctor)",
                });
                return;
              }
              salaCitas.push({
                id: `sala_${i}`,
                hora: fmtHour(tz, ev.startsAt),
                paciente:
                  ev.clase === "hold"
                    ? `🟣 Espacio apartado (${conn.holdTitle || "hold"})`
                    : ev.titulo || "(cita en sala)",
                esApartado: ev.clase === "hold",
                fuente: "sala",
                soloLectura: true,
              });
            });
          }
        }

        const hayInfoSala = salaCitas.length > 0 || salaOcupada.length > 0;
        return {
          fecha: ymd,
          zonaHoraria: tz,
          total: citas.length + salaCitas.length,
          citas: [...citas, ...salaCitas],
          ...(salaOcupada.length > 0 ? { salaOcupada } : {}),
          ...(hayInfoSala
            ? {
                notaSala:
                  "Las citas con fuente:'sala' vienen del calendario de la SALA compartida (solo lectura: NO se editan/cancelan desde aquí). 'salaOcupada' = bloques de OTROS doctores en la sala, sin datos del paciente por privacidad.",
              }
            : {}),
        };
      },
    });

    tools.ver_bandeja = tool({
      description:
        "Conversaciones de WhatsApp que requieren atención: sin leer, en modo humano o escaladas. Úsalo para '¿quién me escribió?', '¿algo pendiente?', '¿hay alguien esperando?'.",
      inputSchema: z.object({}),
      execute: async () => {
        const [convs, nombres] = await Promise.all([
          provider.conversations.list(),
          nameMap(),
        ]);
        const relevantes = convs
          .filter(
            (c) => c.unreadCount > 0 || c.iaState === "humano" || c.unreadCount
          )
          .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1))
          .slice(0, 12);
        return {
          total: relevantes.length,
          conversaciones: relevantes.map((c) => ({
            conversationId: c.id,
            contactId: c.contactId,
            paciente: nombres.get(c.contactId) ?? "(desconocido)",
            sinLeer: c.unreadCount,
            iaState: c.iaState,
            ultimoMensaje: c.lastMessagePreview,
            cuando: fmtHour(tz, c.lastMessageAt),
          })),
        };
      },
    });

    tools.ver_pagos = tool({
      description:
        "Pagos de la clínica (o de un paciente si das contactId). Útil para anticipos pendientes/confirmados.",
      inputSchema: z.object({
        contactId: z.string().optional().describe("id del contacto (cont_)"),
      }),
      execute: async ({ contactId }) => {
        const pagos = await provider.payments.list(
          contactId ? { contactId } : undefined
        );
        return {
          total: pagos.length,
          pagos: pagos.slice(0, 20).map((p) => ({
            contactId: p.patientContactId,
            concepto: p.concepto,
            montoMxn: p.amountMxn,
            estado: p.status,
          })),
        };
      },
    });

    tools.ver_finanzas = tool({
      description:
        "Resumen financiero del período: ingresos, gastos, utilidad y anticipos pendientes por cobrar.",
      inputSchema: z.object({}),
      execute: async () => {
        const dash = await provider.financialReports.dashboard();
        return {
          ingresosMxn: dash.kpis.ingresosMxn,
          gastosMxn: dash.kpis.gastosMxn,
          utilidadMxn: dash.kpis.utilidadMxn,
          anticiposPendientesMxn: dash.kpis.anticiposPendientesMxn,
        };
      },
    });
  }

  // ── 🟢 Escritura operativa (capability: escribir_operativo) ───────────────
  if (has("escribir_operativo")) {
    tools.agendar_cita = tool({
      description:
        "Agenda una cita para un paciente ya identificado (usa antes buscar_paciente y consultar_disponibilidad). Se ejecuta de inmediato.",
      inputSchema: z.object({
        patientContactId: z.string().describe("id del contacto (cont_)"),
        locationId: z.string().describe("id de la sede (loc_)"),
        startsAt: z.string().describe("Inicio ISO con offset"),
        endsAt: z.string().describe("Fin ISO con offset"),
        tipo: AppointmentTypeSchema,
        motivo: z.string(),
      }),
      execute: async (input) => {
        const cita = await provider.appointments.create(input);
        sink.push({
          tool: "agendar_cita",
          tier: "auto",
          summary: `Cita agendada (${input.tipo}) ${fmtHour(tz, input.startsAt)}`,
          payload: input,
          result: { id: cita.id, estado: cita.estado },
        });
        return { ok: true, citaId: cita.id, estado: cita.estado };
      },
    });

    tools.reagendar_cita = tool({
      description:
        "Mueve una cita existente a un nuevo horario. Se ejecuta de inmediato.",
      inputSchema: z.object({
        citaId: z.string().describe("id de la cita (apt_)"),
        startsAt: z.string().describe("Nuevo inicio ISO con offset"),
        endsAt: z.string().describe("Nuevo fin ISO con offset"),
        motivo: z.string().optional(),
      }),
      execute: async ({ citaId, startsAt, endsAt, motivo }) => {
        const cita = await provider.appointments.reschedule(
          citaId,
          startsAt,
          endsAt,
          motivo
        );
        sink.push({
          tool: "reagendar_cita",
          tier: "auto",
          summary: `Cita ${citaId} reagendada a ${fmtHour(tz, startsAt)}`,
          payload: { citaId, startsAt, endsAt, motivo },
          result: { id: cita.id, estado: cita.estado },
        });
        return { ok: true, citaId: cita.id, estado: cita.estado };
      },
    });

    tools.cancelar_cita = tool({
      description:
        "Cancela una cita existente. Se ejecuta de inmediato. Anota el motivo si el doctor lo dio.",
      inputSchema: z.object({
        citaId: z.string().describe("id de la cita (apt_)"),
        motivo: z.string().optional(),
      }),
      execute: async ({ citaId, motivo }) => {
        const cita = await provider.appointments.cancel(citaId, motivo);
        sink.push({
          tool: "cancelar_cita",
          tier: "auto",
          summary: `Cita ${citaId} cancelada`,
          payload: { citaId, motivo },
          result: { id: cita.id, estado: cita.estado },
        });
        return { ok: true, citaId: cita.id, estado: cita.estado };
      },
    });

    tools.bloquear_horario = tool({
      description:
        "Bloquea un horario en la agenda SIN paciente (comida, junta, quirófano ocupado, día personal, vacaciones). Reserva el slot igual que una cita para que no se agende nada encima. Usa consultar_disponibilidad para ubicar la sede. Se ejecuta de inmediato.",
      inputSchema: z.object({
        locationId: z.string().describe("id de la sede (loc_)"),
        startsAt: z.string().describe("Inicio ISO con offset"),
        endsAt: z.string().describe("Fin ISO con offset"),
        titulo: z
          .string()
          .describe("Etiqueta del bloqueo, ej. 'Comida', 'Quirófano ocupado'"),
        motivo: z.string().optional().describe("Nota o motivo adicional"),
        doctorUserId: z
          .string()
          .optional()
          .describe("id del doctor (usr_) si el bloqueo es solo de su agenda"),
      }),
      execute: async ({ locationId, startsAt, endsAt, titulo, motivo, doctorUserId }) => {
        const cita = await provider.appointments.create({
          locationId,
          startsAt,
          endsAt,
          tipo: "bloqueo",
          titulo,
          motivo: motivo || titulo,
          doctorUserId,
        });
        sink.push({
          tool: "bloquear_horario",
          tier: "auto",
          summary: `Horario bloqueado (${titulo}) ${fmtHour(tz, startsAt)}`,
          payload: { locationId, startsAt, endsAt, titulo, motivo, doctorUserId },
          result: { id: cita.id, estado: cita.estado },
        });
        return { ok: true, bloqueoId: cita.id, estado: cita.estado };
      },
    });

    tools.editar_bloqueo = tool({
      description:
        "Edita un bloqueo de horario existente: mueve su horario (startsAt/endsAt) y/o cambia su etiqueta (titulo/motivo). Pasa solo los campos a cambiar. Se ejecuta de inmediato.",
      inputSchema: z.object({
        bloqueoId: z.string().describe("id del bloqueo (apt_)"),
        startsAt: z.string().optional().describe("Nuevo inicio ISO con offset"),
        endsAt: z.string().optional().describe("Nuevo fin ISO con offset"),
        titulo: z.string().optional().describe("Nueva etiqueta"),
        motivo: z.string().optional().describe("Nueva nota/motivo"),
      }),
      execute: async ({ bloqueoId, startsAt, endsAt, titulo, motivo }) => {
        if (startsAt && endsAt) {
          await provider.appointments.reschedule(bloqueoId, startsAt, endsAt, motivo);
        }
        if (titulo !== undefined || motivo !== undefined) {
          await provider.appointments.update(bloqueoId, { titulo, motivo });
        }
        const cita = await provider.appointments.get(bloqueoId);
        sink.push({
          tool: "editar_bloqueo",
          tier: "auto",
          summary: `Bloqueo ${bloqueoId} editado`,
          payload: { bloqueoId, startsAt, endsAt, titulo, motivo },
          result: { id: cita.id, estado: cita.estado },
        });
        return { ok: true, bloqueoId: cita.id, estado: cita.estado };
      },
    });

    tools.eliminar_bloqueo = tool({
      description:
        "Elimina (cancela) un bloqueo de horario y libera el slot. Se ejecuta de inmediato.",
      inputSchema: z.object({
        bloqueoId: z.string().describe("id del bloqueo (apt_)"),
        motivo: z.string().optional(),
      }),
      execute: async ({ bloqueoId, motivo }) => {
        const cita = await provider.appointments.cancel(bloqueoId, motivo);
        sink.push({
          tool: "eliminar_bloqueo",
          tier: "auto",
          summary: `Bloqueo ${bloqueoId} eliminado`,
          payload: { bloqueoId, motivo },
          result: { id: cita.id, estado: cita.estado },
        });
        return { ok: true, bloqueoId: cita.id, estado: cita.estado };
      },
    });

    tools.actualizar_contacto = tool({
      description:
        "Actualiza datos de un contacto (nombre, ciudad, teléfono y/o email). Solo datos confirmados por el doctor; no inventes.",
      inputSchema: z.object({
        contactId: z.string().describe("id del contacto (cont_)"),
        nombre: z.string().optional(),
        ciudad: z.string().optional(),
        telefono: z
          .string()
          .optional()
          .describe("Teléfono/WhatsApp (se guarda en E.164)"),
        email: z.string().optional(),
      }),
      execute: async ({ contactId, nombre, ciudad, telefono, email }) => {
        const partial: {
          nombre?: string;
          ciudad?: string;
          whatsappPhone?: string;
          email?: string;
        } = {};
        if (nombre) partial.nombre = nombre;
        if (ciudad) partial.ciudad = ciudad;
        if (telefono) partial.whatsappPhone = telefono;
        if (email) partial.email = email;
        const c = await provider.contacts.update(contactId, partial);
        sink.push({
          tool: "actualizar_contacto",
          tier: "auto",
          summary: `Contacto ${c.nombre} actualizado`,
          payload: { contactId, ...partial },
          result: { id: c.id },
        });
        return { ok: true, contacto: { id: c.id, nombre: c.nombre } };
      },
    });

    tools.crear_contacto = tool({
      description:
        "Crea un contacto NUEVO (lead) con nombre y teléfono. Úsalo cuando el doctor pida registrar/dar de alta a alguien que no está en el sistema. Solo datos que te dé el doctor; no inventes el teléfono.",
      inputSchema: z.object({
        nombre: z.string().describe("Nombre del contacto"),
        telefono: z
          .string()
          .describe("Teléfono/WhatsApp (se normaliza a E.164)"),
        email: z.string().optional(),
      }),
      execute: async ({ nombre, telefono, email }) => {
        const c = await provider.contacts.create({
          nombre,
          whatsappPhone: telefono,
          ...(email ? { email } : {}),
          // Atribución real del alta: nació por el Concierge, no por el panel.
          canal: "concierge",
        });
        sink.push({
          tool: "crear_contacto",
          tier: "auto",
          summary: `Contacto creado: ${c.nombre}`,
          payload: { nombre, telefono },
          result: { id: c.id },
        });
        return {
          ok: true,
          contacto: { id: c.id, nombre: c.nombre, tipo: c.tipo },
        };
      },
    });

    tools.crear_recordatorio = tool({
      description:
        "Deja un recordatorio/nota para el doctor: aparece de inmediato en sus alertas/notificaciones. Úsalo cuando te pidan 'recuérdame…', 'anota en mi bitácora…', 'no olvides…'. NOTA: aún no programa avisos a una hora futura específica — queda visible al momento; dilo si te piden una hora.",
      inputSchema: z.object({
        texto: z.string().describe("Qué recordar/anotar, en las palabras del doctor"),
      }),
      execute: async ({ texto }) => {
        const rol = db.state.session?.user.rol;
        const notif = await provider.notifications.create({
          tipo: "recordatorio",
          title: "Recordatorio",
          body: texto,
          forRoles: rol ? [rol] : undefined,
        });
        sink.push({
          tool: "crear_recordatorio",
          tier: "auto",
          summary: `Recordatorio: ${texto}`,
          payload: { texto },
          result: { id: notif.id },
        });
        return {
          ok: true,
          nota: "Lo dejé en tus alertas ahora mismo. (Avisos a una hora específica vienen pronto.)",
        };
      },
    });

    tools.notificar_equipo = tool({
      description:
        "Avisa al personal de la clínica (doctores y auxiliares): crea una notificación que les aparece en sus alertas. Úsalo para 'avisa al equipo…', 'notifica a recepción…'. 'El equipo' es SIEMPRE el personal de esta clínica, nunca un soporte externo.",
      inputSchema: z.object({
        mensaje: z.string().describe("Lo que hay que avisarle al equipo"),
      }),
      execute: async ({ mensaje }) => {
        const notif = await provider.notifications.create({
          tipo: "recordatorio",
          title: "Aviso al equipo",
          body: mensaje,
          forRoles: ["administrador", "doctor", "auxiliar"],
        });
        sink.push({
          tool: "notificar_equipo",
          tier: "auto",
          summary: `Aviso al equipo: ${mensaje}`,
          payload: { mensaje },
          result: { id: notif.id },
        });
        return {
          ok: true,
          nota: "Listo, el equipo lo verá en sus alertas.",
        };
      },
    });

    tools.clasificar_lead = tool({
      description:
        "Clasifica un contacto en el CRM (preguntón, interesado, anticipo_pendiente, agendado, seguimiento_futuro o spam). Úsalo cuando el doctor califique a un lead ('márcalo como interesado', 'ese es spam'). Se ejecuta de inmediato.",
      inputSchema: z.object({
        contactId: z.string().describe("id del contacto (cont_)"),
        clasificacion: LeadClassificationValueSchema,
        motivo: z.string().optional().describe("Razón de la clasificación, si el doctor la dio"),
      }),
      execute: async ({ contactId, clasificacion, motivo }) => {
        const c = await provider.contacts.classify(contactId, clasificacion, motivo);
        sink.push({
          tool: "clasificar_lead",
          tier: "auto",
          summary: `${c.nombre} clasificado como ${clasificacion}`,
          payload: { contactId, clasificacion, motivo },
          result: { id: c.id, clasificacion: c.leadClassification },
        });
        return { ok: true, contacto: { id: c.id, clasificacion: c.leadClassification } };
      },
    });

    tools.mover_etapa_pipeline = tool({
      description:
        "Mueve un contacto a otra etapa del pipeline (kanban del CRM). Pasa la etapa por su nombre o key; si no coincide, te devuelvo las etapas disponibles. Se ejecuta de inmediato.",
      inputSchema: z.object({
        contactId: z.string().describe("id del contacto (cont_)"),
        etapa: z.string().describe("Nombre o key de la etapa destino"),
      }),
      execute: async ({ contactId, etapa }) => {
        const stages = await provider.pipeline.listStages();
        const norm = (s: string) => s.trim().toLowerCase();
        const match = stages.find(
          (s) => norm(s.key) === norm(etapa) || norm(s.label) === norm(etapa)
        );
        if (!match) {
          return {
            ok: false,
            error: "No encontré esa etapa.",
            etapasDisponibles: stages.map((s) => ({ key: s.key, nombre: s.label })),
          };
        }
        const c = await provider.contacts.setPipelineStage(contactId, match.id);
        sink.push({
          tool: "mover_etapa_pipeline",
          tier: "auto",
          summary: `${c.nombre} movido a etapa "${match.label}"`,
          payload: { contactId, stageId: match.id },
          result: { id: c.id },
        });
        return { ok: true, contacto: { id: c.id }, etapa: match.label };
      },
    });

    tools.convertir_a_paciente = tool({
      description:
        "Convierte un lead en paciente: crea su expediente clínico conservando el mismo contacto. Úsalo cuando el doctor confirme que un lead ya es paciente. Se ejecuta de inmediato.",
      inputSchema: z.object({
        contactId: z.string().describe("id del contacto (cont_)"),
      }),
      execute: async ({ contactId }) => {
        const c = await provider.contacts.convertToPatient(contactId);
        sink.push({
          tool: "convertir_a_paciente",
          tier: "auto",
          summary: `${c.nombre} convertido a paciente`,
          payload: { contactId },
          result: { id: c.id, tipo: c.tipo, expedienteId: c.patientRecordId },
        });
        return {
          ok: true,
          contacto: { id: c.id, tipo: c.tipo, expedienteId: c.patientRecordId },
        };
      },
    });

    tools.revertir_a_lead = tool({
      description:
        "Revierte un paciente de vuelta a LEAD (deshace una conversión hecha por error). Vuelve el tipo a lead, lo mueve a la primera etapa de leads y desvincula su expediente (NO se borra, queda recuperable). Úsalo cuando el doctor diga que convirtió a alguien por equivocación.",
      inputSchema: z.object({
        contactId: z.string().describe("id del contacto (cont_) a revertir"),
      }),
      execute: async ({ contactId }) => {
        const c = await provider.contacts.revertToLead(contactId);
        sink.push({
          tool: "revertir_a_lead",
          tier: "auto",
          summary: `${c.nombre} revertido a lead`,
          payload: { contactId },
          result: { id: c.id, tipo: c.tipo },
        });
        return { ok: true, contacto: { id: c.id, nombre: c.nombre, tipo: c.tipo } };
      },
    });
  }

  // ── 🟢 Responder al paciente por WhatsApp (capability: responder_whatsapp) ─
  if (has("responder_whatsapp")) {
    tools.responder_whatsapp = tool({
      description:
        "Envía un mensaje de WhatsApp a un paciente/lead en nombre del doctor. Identifica al contacto primero (buscar_paciente). Transcribe el mensaje tal cual; no lo reescribas ni le agregues firma.",
      inputSchema: z.object({
        contactId: z.string().describe("id del contacto (cont_)"),
        mensaje: z.string().describe("Texto literal a enviar"),
      }),
      execute: async ({ contactId, mensaje }) => {
        const conversaciones = await provider.conversations.list();
        const conv = conversaciones.find((c) => c.contactId === contactId);
        if (!conv) {
          return { ok: false, error: "El contacto no tiene conversación abierta" };
        }
        const msg = await provider.messages.send(conv.id, {
          type: "text",
          body: mensaje,
        });
        sink.push({
          tool: "responder_whatsapp",
          tier: "auto",
          summary: `WhatsApp enviado al contacto ${contactId}`,
          payload: { contactId, mensaje },
          result: { messageId: msg.id },
        });
        return { ok: true, messageId: msg.id };
      },
    });
  }

  // ── 🟢 Supervisar al recepcionista (capability: supervisar_recepcionista) ──
  if (has("supervisar_recepcionista")) {
    tools.controlar_recepcionista = tool({
      description:
        "Pausa o reanuda la IA del recepcionista en una conversación (de ver_bandeja). 'pausar' = la IA deja de responder (el humano toma el chat); 'reanudar' = la IA vuelve a contestar.",
      inputSchema: z.object({
        conversationId: z.string().describe("id de la conversación (conv_)"),
        accion: z.enum(["pausar", "reanudar"]),
      }),
      execute: async ({ conversationId, accion }) => {
        const estado = accion === "pausar" ? "pausada" : "ia_activa";
        const conv = await provider.conversations.setIaState(
          conversationId,
          estado
        );
        sink.push({
          tool: "controlar_recepcionista",
          tier: "auto",
          summary: `Recepcionista ${accion === "pausar" ? "pausado" : "reanudado"} en ${conversationId}`,
          payload: { conversationId, accion },
          result: { iaState: conv.iaState },
        });
        return { ok: true, iaState: conv.iaState };
      },
    });

    tools.resolver_escalacion = tool({
      description:
        "Marca una escalación como resuelta (las ves en resumen_clinica / ver_bandeja). Úsalo cuando el doctor diga que ya atendió un caso escalado ('ya resolví el de Ana', 'cierra esa escalación'). Se ejecuta de inmediato.",
      inputSchema: z.object({
        escalationId: z.string().describe("id de la escalación (esc_)"),
      }),
      execute: async ({ escalationId }) => {
        const esc = await provider.escalations.resolve(escalationId);
        sink.push({
          tool: "resolver_escalacion",
          tier: "auto",
          summary: `Escalación ${escalationId} resuelta`,
          payload: { escalationId },
          result: { id: esc.id, estado: esc.estado },
        });
        return { ok: true, escalacion: { id: esc.id, estado: esc.estado } };
      },
    });
  }

  // ── 🟡 Dinero (capability: dinero) — PROPONE, no ejecuta ──────────────────
  if (has("dinero")) {
    tools.proponer_cobro = tool({
      description:
        "Propone registrar un cobro/anticipo. NO lo aplica: deja una propuesta que el doctor confirma. El dinero siempre requiere confirmación.",
      inputSchema: z.object({
        patientContactId: z.string().describe("id del contacto (cont_)"),
        amountMxn: z.number().describe("Monto en MXN"),
        concepto: PaymentConceptSchema,
        method: PaymentMethodSchema.optional().describe(
          "Medio de pago si el doctor lo indicó; default transferencia"
        ),
        appointmentId: z
          .string()
          .optional()
          .describe("id de la cita (apt_) si aplica"),
      }),
      execute: async (input) => {
        sink.push({
          tool: "registrar_pago",
          tier: "confirma",
          summary: `Registrar pago de $${input.amountMxn} MXN (${input.concepto})`,
          payload: input,
        });
        return {
          propuesto: true,
          nota: "Propuesta creada. Queda pendiente de que el doctor la confirme; el dinero no se registró todavía.",
        };
      },
    });

    tools.registrar_gasto = tool({
      description:
        "Registra un GASTO operativo de la clínica (insumos, renta, nómina, equipo, marketing, servicios u otros). Esto es captura contable de un egreso ya hecho — NO mueve caja como un cobro, así que se registra de inmediato (no requiere confirmación). Sin fecha = hoy. Úsalo para 'registra un gasto de $1,200 de insumos', 'apunta la renta del mes'.",
      inputSchema: z.object({
        categoria: ExpenseCategorySchema,
        amountMxn: z.number().describe("Monto del gasto en MXN"),
        descripcion: z.string().describe("Descripción del gasto"),
        proveedorNombre: z.string().optional().describe("Proveedor/emisor, si se dio"),
        fecha: z.string().optional().describe("YYYY-MM-DD; vacío = hoy"),
        comprobanteUrl: z
          .string()
          .optional()
          .describe("Foto/ticket del gasto que mandó el doctor (URL wa-media), si la hay"),
      }),
      execute: async ({ categoria, amountMxn, descripcion, proveedorNombre, fecha, comprobanteUrl }) => {
        const gasto = await provider.expenses.create({
          categoria,
          amountMxn,
          descripcion,
          date: fecha || todayYmd(),
          ...(proveedorNombre ? { proveedorNombre } : {}),
        });
        // Si vino un ticket por WhatsApp, captúralo como Asset (→ MinIO) ligado al
        // gasto. Best-effort: nunca rompe el registro que ya quedó. Lo subió el
        // doctor/auxiliar (db.actor), no el paciente.
        if (
          process.env.WA_MEDIA_ASSETS !== "false" &&
          comprobanteUrl?.startsWith("wa-media:")
        ) {
          const mediaId = comprobanteUrl.slice("wa-media:".length);
          const bytes = await fetchWaMediaBytes(db, mediaId).catch(() => null);
          if (bytes && bytes.length <= MAX_ASSET_BYTES) {
            const mime = sniffImageMime(bytes);
            await provider.assets
              .create({
                kind: "image",
                category: "ticket_gasto",
                mimeType: mime,
                refs: { expenseId: gasto.id },
                source: "whatsapp",
                externalId: mediaId,
                uploadedBy: db.actor(),
                dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
              })
              .catch(() => {});
          }
        }
        sink.push({
          tool: "registrar_gasto",
          tier: "auto",
          summary: `Gasto registrado: $${amountMxn} MXN (${categoria}) — ${descripcion}`,
          payload: { categoria, amountMxn, descripcion, proveedorNombre, fecha },
          result: { id: gasto.id, categoria: gasto.categoria, montoMxn: gasto.amountMxn },
        });
        return {
          ok: true,
          gasto: { id: gasto.id, categoria: gasto.categoria, montoMxn: gasto.amountMxn },
        };
      },
    });

    tools.editar_gasto = tool({
      description:
        "Corrige un GASTO ya registrado (monto, categoría, descripción, fecha o proveedor). Identifícalo por su id (lo ves en ver_finanzas). Solo manda los campos que cambian.",
      inputSchema: z.object({
        gastoId: z.string().describe("id del gasto (exp_)"),
        categoria: ExpenseCategorySchema.optional(),
        amountMxn: z.number().optional().describe("Nuevo monto en MXN"),
        descripcion: z.string().optional(),
        proveedorNombre: z.string().optional(),
        fecha: z.string().optional().describe("YYYY-MM-DD"),
      }),
      execute: async ({ gastoId, categoria, amountMxn, descripcion, proveedorNombre, fecha }) => {
        const gasto = await provider.expenses.update(gastoId, {
          ...(categoria ? { categoria } : {}),
          ...(amountMxn !== undefined ? { amountMxn } : {}),
          ...(descripcion ? { descripcion } : {}),
          ...(proveedorNombre ? { proveedorNombre } : {}),
          ...(fecha ? { date: fecha } : {}),
        });
        sink.push({
          tool: "editar_gasto",
          tier: "auto",
          summary: `Gasto ${gastoId} editado`,
          payload: { gastoId, categoria, amountMxn, descripcion, proveedorNombre, fecha },
          result: { id: gasto.id, montoMxn: gasto.amountMxn },
        });
        return {
          ok: true,
          gasto: { id: gasto.id, categoria: gasto.categoria, montoMxn: gasto.amountMxn },
        };
      },
    });

    tools.eliminar_gasto = tool({
      description:
        "Elimina un GASTO registrado por error. Identifícalo por su id (ver_finanzas). Borra solo gastos; nunca toca cobros ni pagos de pacientes.",
      inputSchema: z.object({
        gastoId: z.string().describe("id del gasto (exp_)"),
      }),
      execute: async ({ gastoId }) => {
        await provider.expenses.remove(gastoId);
        sink.push({
          tool: "eliminar_gasto",
          tier: "auto",
          summary: `Gasto ${gastoId} eliminado`,
          payload: { gastoId },
          result: { id: gastoId },
        });
        return { ok: true, eliminado: gastoId };
      },
    });
  }

  // ── 🟢 Documentos (capability: documentos) ────────────────────────────────
  if (has("documentos")) {
    tools.ver_documentos = tool({
      description:
        "Lista las cotizaciones y recetas de un paciente con folio y estado (borrador/aprobada/enviada).",
      inputSchema: z.object({
        contactId: z.string().describe("id del contacto (cont_)"),
      }),
      execute: async ({ contactId }) => {
        const rec = await provider.patientRecords.getByContact(contactId);
        if (!rec) {
          return {
            encontrados: 0,
            documentos: [],
            nota: "El contacto aún no tiene expediente.",
          };
        }
        const docs = await provider.documents.listForRecord(rec.id);
        return {
          encontrados: docs.length,
          documentos: docs.map((d) => ({
            id: d.id,
            tipo: d.tipo,
            folio: d.folio,
            estado: d.status,
            // Link de descarga del PDF (solo si ya está aprobado/enviado; los
            // borradores no tienen PDF). Compártelo en el chat con el usuario.
            pdfUrl: d.pdfUrl,
          })),
        };
      },
    });

    tools.crear_cotizacion = tool({
      description:
        "Genera una cotización en BORRADOR para un paciente (paridad OpenClaw). Queda lista para que el doctor la revise, apruebe y envíe desde Documentos. NO la envía sola.",
      inputSchema: z.object({
        contactId: z.string().describe("id del contacto (cont_)"),
        conceptos: z
          .array(
            z.object({
              label: z.string().describe("Concepto/procedimiento"),
              cantidad: z.number().default(1),
              precioUnitarioMxn: z.number(),
            })
          )
          .min(1),
        anticipoSugeridoMxn: z.number().optional(),
        vigenciaDias: z.number().optional(),
      }),
      execute: async ({
        contactId,
        conceptos,
        anticipoSugeridoMxn,
        vigenciaDias,
      }) => {
        let rec = await provider.patientRecords.getByContact(contactId);
        if (!rec) {
          await provider.contacts.convertToPatient(contactId);
          rec = await provider.patientRecords.getByContact(contactId);
        }
        if (!rec) {
          return { ok: false, error: "No pude obtener/crear el expediente." };
        }
        const doc = await provider.documents.create({
          patientRecordId: rec.id,
          tipo: "cotizacion",
        });
        const lines = conceptos.map((c) => ({
          label: c.label,
          qty: c.cantidad,
          unitPriceMxn: c.precioUnitarioMxn,
          totalMxn: c.cantidad * c.precioUnitarioMxn,
        }));
        const totalMxn = lines.reduce((s, l) => s + l.totalMxn, 0);
        const updated = await provider.documents.update(doc.id, {
          cotizacion: {
            lines,
            totalMxn,
            vigenciaDias: vigenciaDias ?? 15,
            ...(anticipoSugeridoMxn ? { anticipoSugeridoMxn } : {}),
          },
        });
        sink.push({
          tool: "crear_cotizacion",
          tier: "auto",
          summary: `Cotización ${updated.folio} (borrador) por $${totalMxn} MXN`,
          payload: { contactId, conceptos },
          result: { id: updated.id, folio: updated.folio },
        });
        return {
          ok: true,
          folio: updated.folio,
          totalMxn,
          estado: updated.status,
          nota: "Quedó en borrador. Revísala y envíala desde Documentos.",
        };
      },
    });

    tools.crear_receta = tool({
      description:
        "Genera una RECETA médica en BORRADOR para un paciente. Queda lista para que el doctor la " +
        "revise y apruebe (aprobar_documento genera el PDF, que entregas en el chat). NO la envía sola. " +
        "Para cobros/precios usa crear_cotizacion; esto es solo prescripción.",
      inputSchema: z.object({
        contactId: z.string().describe("id del contacto (cont_)"),
        medicamentos: z
          .array(
            z.object({
              nombre: z.string().describe("Nombre comercial o genérico"),
              presentacion: z
                .string()
                .optional()
                .describe('ej. "Tableta 500 mg", "Spray nasal"'),
              dosis: z.string().describe('Dosis por toma, ej. "500 mg"'),
              via: z.string().optional().describe('ej. "Oral", "Tópica nasal"'),
              frecuencia: z.string().describe('ej. "cada 8 horas"'),
              duracion: z.string().describe('ej. "7 días"'),
            })
          )
          .min(1),
        indicaciones: z
          .string()
          .describe("Indicaciones generales para el paciente"),
        diagnostico: z
          .string()
          .optional()
          .describe("Diagnóstico o impresión diagnóstica (opcional)"),
      }),
      execute: async ({ contactId, medicamentos, indicaciones, diagnostico }) => {
        let rec = await provider.patientRecords.getByContact(contactId);
        if (!rec) {
          await provider.contacts.convertToPatient(contactId);
          rec = await provider.patientRecords.getByContact(contactId);
        }
        if (!rec) {
          return { ok: false, error: "No pude obtener/crear el expediente." };
        }
        const doc = await provider.documents.create({
          patientRecordId: rec.id,
          tipo: "receta",
        });
        const updated = await provider.documents.update(doc.id, {
          receta: {
            medicamentos,
            indicaciones,
            ...(diagnostico ? { diagnostico } : {}),
          },
        });
        sink.push({
          tool: "crear_receta",
          tier: "auto",
          summary: `Receta ${updated.folio} (borrador), ${medicamentos.length} medicamento(s)`,
          payload: { contactId, medicamentos: medicamentos.length },
          result: { id: updated.id, folio: updated.folio },
        });
        return {
          ok: true,
          folio: updated.folio,
          estado: updated.status,
          nota: "Quedó en borrador. Apruébala (aprobar_documento) para generar el PDF y entrégalo en el chat.",
        };
      },
    });

    tools.aprobar_documento = tool({
      description:
        "Aprueba un documento de CUALQUIER tipo (cotización, receta, constancia, …) en borrador: " +
        "genera su PDF y lo archiva al expediente. Devuelve `pdfUrl`, el link de descarga del PDF. " +
        "SIEMPRE entrégale ese link al usuario en el chat como enlace markdown " +
        "(ej. `📄 [Descargar COT-006 (PDF)](pdfUrl)`) para que lo abra/descargue. " +
        "Esto NO se lo manda al paciente; para enviárselo por WhatsApp usa enviar_documento. " +
        "Usa antes ver_documentos para el id. Se ejecuta de inmediato.",
      inputSchema: z.object({
        documentId: z.string().describe("id del documento (doc_)"),
      }),
      execute: async ({ documentId }) => {
        const doc = await provider.documents.approve(documentId);
        sink.push({
          tool: "aprobar_documento",
          tier: "auto",
          summary: `Documento ${doc.folio} aprobado`,
          payload: { documentId },
          result: { id: doc.id, folio: doc.folio, estado: doc.status, pdfUrl: doc.pdfUrl },
        });
        return {
          ok: true,
          documento: {
            id: doc.id,
            tipo: doc.tipo,
            folio: doc.folio,
            estado: doc.status,
            // Link de descarga del PDF recién generado. Compártelo en el chat.
            pdfUrl: doc.pdfUrl,
          },
          nota: doc.pdfUrl
            ? `PDF listo. Dale al usuario el link en el chat: 📄 [Descargar ${doc.folio} (PDF)](${doc.pdfUrl})`
            : undefined,
        };
      },
    });

    tools.enviar_documento = tool({
      description:
        "Envía por WhatsApp un documento ya aprobado AL PACIENTE (crea el mensaje real en su chat de WhatsApp). " +
        "Requiere que el paciente ya tenga conversación de WhatsApp; si falla por eso, NO es un error del sistema: " +
        "entrégale al doctor/auxiliar el link del PDF (pdfUrl de aprobar_documento/ver_documentos) en el chat para que lo comparta. " +
        "Para solo dárselo al usuario aquí (no al paciente) NO uses esta tool: comparte el pdfUrl. " +
        "Si está en borrador, apruébalo primero con aprobar_documento. Se ejecuta de inmediato.",
      inputSchema: z.object({
        documentId: z.string().describe("id del documento (doc_)"),
      }),
      execute: async ({ documentId }) => {
        const doc = await provider.documents.sendByWhatsApp(documentId);
        sink.push({
          tool: "enviar_documento",
          tier: "auto",
          summary: `Documento ${doc.folio} enviado por WhatsApp`,
          payload: { documentId },
          result: { id: doc.id, folio: doc.folio, estado: doc.status },
        });
        return { ok: true, documento: { id: doc.id, folio: doc.folio, estado: doc.status } };
      },
    });
  }

  // ── 🟢 Archivos del expediente en Drive (capability: drive) ───────────────
  if (has("drive")) {
    tools.ver_archivos_expediente = tool({
      description:
        "Lista los archivos del expediente del paciente en Google Drive (cotizaciones, recetas, estudios).",
      inputSchema: z.object({
        contactId: z.string().describe("id del contacto (cont_)"),
      }),
      execute: async ({ contactId }) => {
        const rec = await provider.patientRecords.getByContact(contactId);
        if (!rec) {
          return {
            encontrados: 0,
            archivos: [],
            nota: "El contacto aún no tiene expediente.",
          };
        }
        const archivos = await provider.googleDrive.listForRecord(rec.id);
        return {
          encontrados: archivos.length,
          archivos: archivos.map((f) => ({
            nombre: f.name,
            tipo: f.kind,
            link: f.webViewLink,
          })),
        };
      },
    });
  }

  // ── Cobertura ampliada (harness-first): exponer más superficie del provider ──
  if (has("leer")) {
    tools.leer_conversacion = tool({
      description:
        "Lee los mensajes REALES del chat de WhatsApp de un paciente (lo que escribió, no solo metadata). Úsalo para '¿qué me dijo?', '¿qué escribió?', leer el hilo. Da el contactId (de buscar_paciente/ver_bandeja).",
      inputSchema: z.object({
        contactId: z.string().describe("id del contacto (cont_)"),
        limite: z
          .number()
          .optional()
          .describe("Cuántos mensajes recientes (default 20)"),
      }),
      execute: async ({ contactId, limite }) => {
        const convs = await provider.conversations.list();
        const conv = convs.find((c) => c.contactId === contactId);
        if (!conv)
          return {
            encontrados: 0,
            nota: "Este contacto no tiene conversación de WhatsApp.",
          };
        const msgs = await provider.messages.list(conv.id);
        const recientes = msgs.slice(-(limite ?? 20));
        return {
          conversationId: conv.id,
          total: msgs.length,
          mensajes: recientes.map((m) => ({
            autor: m.authorType,
            cuando: fmtHour(tz, m.sentAt),
            texto: m.body ?? `[${m.type}]`,
          })),
        };
      },
    });

    tools.ver_equipo = tool({
      description:
        "Lista los miembros del equipo de la clínica (id, nombre, rol). Úsalo para saber a quién asignar una conversación o escalación.",
      inputSchema: z.object({}),
      execute: async () => {
        const users = await provider.users.list();
        return {
          equipo: users.map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol })),
        };
      },
    });

    tools.ver_auditoria = tool({
      description:
        "Último reporte de auditoría operativa (Kika): score de salud, verificaciones y hallazgos. Para '¿cómo va la auditoría?', '¿hay algo mal en los datos?'.",
      inputSchema: z.object({}),
      execute: async () => {
        const r = await provider.auditReports.latest();
        return { reporte: r };
      },
    });

    tools.ver_consultas = tool({
      description:
        "Consultas/sesiones de copiloto recientes (resumen y accionables del doctor). Opcional por doctor (ver_equipo para su id).",
      inputSchema: z.object({
        doctorUserId: z.string().optional(),
      }),
      execute: async ({ doctorUserId }) => {
        const list = await provider.consultations.listRecent(doctorUserId);
        return { total: list.length, consultas: list.slice(0, 10) };
      },
    });

    tools.resumen_del_dia = tool({
      description:
        "Resumen del día de un doctor (sus consultas/pendientes). Requiere el id del doctor (ver_equipo); fecha YYYY-MM-DD opcional (default hoy).",
      inputSchema: z.object({
        doctorUserId: z.string(),
        fecha: z.string().optional().describe("YYYY-MM-DD; vacío = hoy"),
      }),
      execute: async ({ doctorUserId, fecha }) => {
        const digest = await provider.consultations.dailyDigest(
          doctorUserId,
          fecha || todayYmd()
        );
        return { digest };
      },
    });

    tools.ver_prevaloracion = tool({
      description:
        "Prevaloración (cuestionario previo) que llenó un paciente, si existe. Da el contactId.",
      inputSchema: z.object({ contactId: z.string() }),
      execute: async ({ contactId }) => {
        const pa = await provider.preAssessments.getForContact(contactId);
        return pa ? { encontrada: true, prevaloracion: pa } : { encontrada: false };
      },
    });

    tools.marcar_conversacion_leida = tool({
      description:
        "Marca una conversación como leída (limpia el contador de no leídos). Da el conversationId (de ver_bandeja).",
      inputSchema: z.object({ conversationId: z.string() }),
      execute: async ({ conversationId }) => {
        await provider.conversations.markRead(conversationId);
        return { ok: true };
      },
    });
  }

  if (has("escribir_operativo")) {
    tools.asignar_conversacion = tool({
      description:
        "Asigna una conversación de WhatsApp a un miembro del equipo para que la atienda. Da el conversationId (ver_bandeja) y el userId (ver_equipo); userId vacío = desasignar.",
      inputSchema: z.object({
        conversationId: z.string(),
        userId: z.string().optional().describe("id del miembro; vacío = desasignar"),
      }),
      execute: async ({ conversationId, userId }) => {
        const conv = await provider.conversations.assign(conversationId, userId);
        sink.push({
          tool: "asignar_conversacion",
          tier: "auto",
          summary: `Conversación ${conversationId} asignada`,
          payload: { conversationId, userId },
          result: { id: conv.id },
        });
        return { ok: true, conversacion: { id: conv.id } };
      },
    });

    tools.confirmar_cita = tool({
      description:
        "Confirma una cita (solo válido si el anticipo requerido ya está pagado). Da el id de la cita (apt_, de ver_agenda).",
      inputSchema: z.object({ citaId: z.string() }),
      execute: async ({ citaId }) => {
        const cita = await provider.appointments.confirm(citaId);
        sink.push({
          tool: "confirmar_cita",
          tier: "auto",
          summary: `Cita ${citaId} confirmada`,
          payload: { citaId },
          result: { id: cita.id, estado: cita.estado },
        });
        return { ok: true, cita: { id: cita.id, estado: cita.estado } };
      },
    });

    tools.archivar_contacto = tool({
      description:
        "Archiva un contacto (lo oculta de las listas; recuperable, no borra nada). Para 'archiva a…', 'quita de la lista a…'.",
      inputSchema: z.object({ contactId: z.string() }),
      execute: async ({ contactId }) => {
        const c = await provider.contacts.archive(contactId);
        sink.push({
          tool: "archivar_contacto",
          tier: "auto",
          summary: `${c.nombre} archivado`,
          payload: { contactId },
          result: { id: c.id },
        });
        return { ok: true, contacto: { id: c.id, nombre: c.nombre } };
      },
    });

    tools.restaurar_contacto = tool({
      description:
        "Restaura un contacto archivado (lo vuelve a mostrar en las listas).",
      inputSchema: z.object({ contactId: z.string() }),
      execute: async ({ contactId }) => {
        const c = await provider.contacts.unarchive(contactId);
        sink.push({
          tool: "restaurar_contacto",
          tier: "auto",
          summary: `${c.nombre} restaurado`,
          payload: { contactId },
          result: { id: c.id },
        });
        return { ok: true, contacto: { id: c.id, nombre: c.nombre } };
      },
    });

    tools.marcar_prevaloracion_revisada = tool({
      description:
        "Marca como revisada la prevaloración de un paciente. Da el id de la prevaloración (ver_prevaloracion).",
      inputSchema: z.object({ prevaloracionId: z.string() }),
      execute: async ({ prevaloracionId }) => {
        const pa = await provider.preAssessments.markReviewed(prevaloracionId);
        sink.push({
          tool: "marcar_prevaloracion_revisada",
          tier: "auto",
          summary: `Prevaloración ${prevaloracionId} revisada`,
          payload: { prevaloracionId },
          result: { id: pa.id },
        });
        return { ok: true };
      },
    });

    tools.actualizar_expediente = tool({
      description:
        "Actualiza datos NO clínicos del expediente de un paciente: ciudad y/o campos personalizados. NUNCA toca antecedentes ni notas clínicas. Da el id del expediente (rec_, de consultar_expediente).",
      inputSchema: z.object({
        expedienteId: z.string().describe("id del expediente (rec_)"),
        ciudad: z.string().optional(),
        customFields: z
          .record(z.string(), z.union([z.string(), z.number()]))
          .optional(),
      }),
      execute: async ({ expedienteId, ciudad, customFields }) => {
        const rec = await provider.patientRecords.update(expedienteId, {
          ...(ciudad ? { demografia: { ciudad } } : {}),
          ...(customFields ? { customFields } : {}),
        });
        sink.push({
          tool: "actualizar_expediente",
          tier: "auto",
          summary: `Expediente ${expedienteId} actualizado`,
          payload: { expedienteId, ciudad, customFields },
          result: { id: rec.id },
        });
        return { ok: true, expediente: { id: rec.id } };
      },
    });
  }

  if (has("supervisar_recepcionista")) {
    tools.asignar_escalacion = tool({
      description:
        "Asigna una escalación a un miembro del equipo. Da el id de la escalación (esc_, de resumen_clinica/ver_bandeja) y el userId (ver_equipo).",
      inputSchema: z.object({ escalationId: z.string(), userId: z.string() }),
      execute: async ({ escalationId, userId }) => {
        const esc = await provider.escalations.assign(escalationId, userId);
        sink.push({
          tool: "asignar_escalacion",
          tier: "auto",
          summary: `Escalación ${escalationId} asignada`,
          payload: { escalationId, userId },
          result: { id: esc.id, estado: esc.estado },
        });
        return { ok: true, escalacion: { id: esc.id, estado: esc.estado } };
      },
    });

    tools.modo_consultor_ventas = tool({
      description:
        "Activa/desactiva el modo 'consultor de ventas' del recepcionista en una conversación (respuestas más orientadas a cerrar). Da el conversationId.",
      inputSchema: z.object({ conversationId: z.string(), activar: z.boolean() }),
      execute: async ({ conversationId, activar }) => {
        const conv = await provider.conversations.setSalesConsultantMode(
          conversationId,
          activar
        );
        sink.push({
          tool: "modo_consultor_ventas",
          tier: "auto",
          summary: `Modo consultor ${activar ? "activado" : "desactivado"} en ${conversationId}`,
          payload: { conversationId, activar },
          result: { id: conv.id },
        });
        return { ok: true };
      },
    });

    tools.mover_a_blacklist = tool({
      description:
        "Agrega un número a la lista negra: el recepcionista deja de responderle. Reversible (se puede quitar). Da el teléfono y un motivo; opcionalmente el contactId.",
      inputSchema: z.object({
        telefono: z.string(),
        motivo: z.string(),
        contactId: z.string().optional(),
      }),
      execute: async ({ telefono, motivo, contactId }) => {
        const entry = await provider.blacklist.add({
          phone: telefono,
          motivo,
          ...(contactId ? { contactId } : {}),
        });
        sink.push({
          tool: "mover_a_blacklist",
          tier: "auto",
          summary: `${telefono} movido a blacklist (${motivo})`,
          payload: { telefono, motivo, contactId },
          result: { id: entry.id },
        });
        return { ok: true };
      },
    });
  }

  if (has("dinero")) {
    tools.ver_gastos = tool({
      description:
        "Lista los gastos registrados (filtrables por mes YYYY-MM y/o categoría). Para '¿cuánto gasté este mes?', 'muéstrame los gastos de insumos'.",
      inputSchema: z.object({
        mes: z.string().optional().describe("YYYY-MM"),
        categoria: ExpenseCategorySchema.optional(),
      }),
      execute: async ({ mes, categoria }) => {
        const gastos = await provider.expenses.list({
          ...(mes ? { month: mes } : {}),
          ...(categoria ? { categoria } : {}),
        });
        return {
          total: gastos.length,
          sumaMxn: gastos.reduce((s, g) => s + g.amountMxn, 0),
          gastos: gastos.map((g) => ({
            id: g.id,
            fecha: g.date,
            categoria: g.categoria,
            montoMxn: g.amountMxn,
            descripcion: g.descripcion,
            proveedor: g.proveedorNombre,
          })),
        };
      },
    });

    tools.generar_reporte_financiero = tool({
      description:
        "Genera (o regenera) el reporte financiero mensual de un período YYYY-MM a partir de pagos confirmados y gastos. Devuelve ingresos, gastos, utilidad y alertas.",
      inputSchema: z.object({ periodo: z.string().describe("YYYY-MM") }),
      execute: async ({ periodo }) => {
        const r = await provider.financialReports.generate(periodo);
        sink.push({
          tool: "generar_reporte_financiero",
          tier: "auto",
          summary: `Reporte financiero ${periodo} generado`,
          payload: { periodo },
          result: { periodo },
        });
        return { ok: true, reporte: r };
      },
    });

    tools.confirmar_pago = tool({
      description:
        "Confirma un pago pendiente de confirmación. Da el id del pago (pay_, de ver_pagos). Úsalo cuando el doctor diga 'confirma el pago de X'.",
      inputSchema: z.object({ pagoId: z.string() }),
      execute: async ({ pagoId }) => {
        const pago = await provider.payments.confirm(pagoId);
        sink.push({
          tool: "confirmar_pago",
          tier: "auto",
          summary: `Pago ${pagoId} confirmado`,
          payload: { pagoId },
          result: { id: pago.id },
        });
        return { ok: true, pago: { id: pago.id } };
      },
    });
  }

  return hardenTools(tools);
}

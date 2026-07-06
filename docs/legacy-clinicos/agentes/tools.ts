/**
 * Tools del agente recepcionista (contact-scoped).
 *
 * Cada tool es una función TypeScript que opera sobre el DataProvider de la
 * sesión — la MISMA interfaz que usa el frontend. Crear una skill nueva para
 * un cliente = agregar una función aquí y activarla con `enabledTools` en su
 * AgentConfig. Sin sandbox, sin comandos de shell: nada que se "rompa" como el
 * exec-allowlist de OpenClaw (su bug #1).
 *
 * Regla de identidad (regla de oro): cada set de tools se construye LIGADO a un
 * contacto/conversación concretos — el agente no puede tocar datos de otros
 * pacientes ni el LLM decide los ids.
 *
 * Fiabilidad del CRM (fix del bug de Coco): los hitos (cita confirmada,
 * reagenda, cancelación) escriben el CRM y crean la notificación DENTRO de la
 * tool, no dependen de que el modelo lo recuerde después.
 *
 * Las tools de consulta contact-independientes (`consultar_catalogo`,
 * `enviar_ubicacion`, `consultar_disponibilidad`) viven en `shared-tools.ts`
 * y se componen aquí; cualquier futuro agente puede reutilizarlas sin
 * instanciar el builder completo.
 */
import { tool, generateObject, type ToolSet } from "ai";
import { z } from "zod";
import type { ProviderInstance } from "@clinicos/mocks";
import type {
  NotificationType,
  PaymentConcept,
  LeadClassificationValue,
} from "@clinicos/contracts";
import { pushAppointmentToGoogle } from "../google-sync";
import { resolveVisionModel } from "./model";
import { resolveImageForVision } from "../media";
import { captureAgendadoWin } from "../memory";
import { buildSharedQueryTools } from "./shared-tools";
import { canAdvanceClassification } from "./funnel";

/** Tope para capturar una imagen como Asset (evita 3 copias en RAM). 15 MB,
 * mismo techo que el pipeline de comprensión y la captura del webhook. */
const MAX_ASSET_BYTES = 15_000_000;

/** Detecta el MIME de imagen por los magic bytes (jpeg/png/webp/gif). El default
 * es jpeg (WhatsApp entrega casi todo en jpeg). Evita guardar un png/webp como
 * jpeg, que rompería el render del navegador y el re-procesamiento de la ingesta. */
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
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
    return "image/gif";
  return "image/jpeg";
}

/**
 * Valida una URL de imagen/adjunto contra la allowlist de hosts aceptados.
 *
 * Solo se permite HTTPS y un conjunto cerrado de dominios de almacenamiento
 * conocidos (Meta CDN, Google Drive/User Content, S3, Cloudflare R2, Supabase).
 * Esto previene SSRF / exfiltración si el modelo inyecta URLs arbitrarias.
 *
 * Retorna la URL como string si es válida, o lanza un Error con descripción.
 */
const ALLOWED_URL_HOSTS = [
  // Meta CDN (imágenes de WhatsApp descargadas por el proxy /media/:id)
  /^[^.]+\.whatsapp\.net$/,
  /^[^.]+\.fbcdn\.net$/,
  // Nota: NO se permite localhost/127.0.0.1 — el proxy /media valida sesión
  // por su cuenta y el modelo nunca debe construir URLs internas (vector SSRF).
  // Google Drive / Fotos
  /^drive\.google\.com$/,
  /^[^.]+\.googleusercontent\.com$/,
  /^[^.]+\.usercontent\.google\.com$/,
  // AWS S3 y compatibles
  /^[^.]+\.s3\.amazonaws\.com$/,
  /^[^.]+\.s3\.[^.]+\.amazonaws\.com$/,
  // Cloudflare R2 / Images (NO *.cloudflare.com: cualquiera crea un Worker ahí)
  /^[^.]+\.r2\.cloudflarestorage\.com$/,
  /^[^.]+\.imagedelivery\.net$/,
  // Supabase Storage — acotado al formato de project-ref (20 chars), no *.supabase.*
  /^[a-z0-9]{20}\.supabase\.co$/,
];

export function assertSafeMediaUrl(rawUrl: string, field = "url"): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${field} inválida — no es una URL bien formada`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${field} rechazada — se requiere HTTPS (protocolo: ${parsed.protocol})`);
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_URL_HOSTS.some((re) => re.test(host));
  if (!allowed) {
    throw new Error(
      `${field} rechazada — host no permitido: ${host}. Usa una URL de un almacenamiento conocido (WhatsApp, Google Drive, S3, etc.)`
    );
  }
  return rawUrl;
}

export interface ToolContext {
  instance: ProviderInstance;
  conversationId: string;
  contactId: string;
  /** Tools habilitadas para esta clínica. Vacío/ausente = todas. */
  enabledTools?: string[];
}

/**
 * Filtra un ToolSet completo dejando solo las keys listadas en `enabled`.
 * Si `enabled` está vacío o ausente devuelve `all` sin modificar.
 * Función reutilizable por cualquier builder de tools.
 */
export function filterTools(all: ToolSet, enabled?: string[]): ToolSet {
  if (!enabled || enabled.length === 0) return all;
  const filtered: ToolSet = {};
  for (const key of enabled) {
    const t = all[key];
    if (t) filtered[key] = t;
  }
  return filtered;
}

/**
 * Construye el ToolSet completo ligado a un contacto/conversación concretos.
 *
 * Compone:
 *  - tools de consulta contact-independientes (de `shared-tools.ts`)
 *  - tools contact-scoped (expediente, citas, pagos, escalaciones…)
 *
 * Renombrado desde `buildRecepcionistaTools` (Etapa 2). El alias de
 * compatibilidad al final del archivo evita churn en los call-sites existentes.
 */
export function buildContactScopedTools({
  instance,
  conversationId,
  contactId,
  enabledTools,
}: ToolContext) {
  const { provider } = instance;
  const cid = () => instance.db.clinicId();

  /** Crea una notificación sin tumbar la tool si algo falla. */
  async function notify(
    tipo: NotificationType,
    title: string,
    body: string,
    appointmentId?: string
  ) {
    try {
      await provider.notifications.create({
        tipo,
        title,
        body,
        contactId,
        conversationId,
        appointmentId,
      });
    } catch {
      /* la notificación es best-effort; nunca rompe el flujo del agente */
    }
  }

  /**
   * Resuelve una imagen para visión Y captura: `wa-media:<id>` → baja los bytes
   * de Meta (token-gated, sin allowlist — es nuestro media autenticado); http(s)
   * → valida contra la allowlist anti-SSRF y pasa la URL. Devuelve lo que el SDK
   * acepta como `image`, más los bytes LOCALES (solo para wa-media) para poder
   * capturarlos como Asset sin una segunda descarga. `null` si no se puede usar.
   */
  async function resolveToolImage(
    url: string
  ): Promise<{ image: Uint8Array | URL; bytes: Uint8Array | null; mediaId: string | null } | null> {
    if (url.startsWith("wa-media:")) {
      const resolved = await resolveImageForVision(instance.db, url);
      if (!(resolved instanceof Uint8Array)) return null; // descarga falló
      return { image: resolved, bytes: resolved, mediaId: url.slice("wa-media:".length) };
    }
    try {
      assertSafeMediaUrl(url, "imagen");
    } catch {
      return null; // host no permitido / no-https
    }
    return { image: new URL(url), bytes: null, mediaId: null };
  }

  /**
   * Captura una imagen ya descargada como Asset (→ MinIO vía withAssetStorage,
   * dispara ingesta). Best-effort: nunca rompe el flujo del agente. Tope de tamaño
   * y dedup por externalId (el wa-media id). uploadedBy = el contacto/paciente.
   */
  async function captureImageAsset(
    bytes: Uint8Array,
    category: "ticket_gasto" | "foto_clinica",
    externalId: string,
    extraRefs: { appointmentId?: string } = {}
  ): Promise<void> {
    if (process.env.WA_MEDIA_ASSETS === "false") return; // mismo kill-switch que el webhook
    if (bytes.length > MAX_ASSET_BYTES) return;
    const mime = sniffImageMime(bytes);
    try {
      await provider.assets.create({
        kind: "image",
        category,
        mimeType: mime,
        refs: { contactId, conversationId, ...extraRefs },
        source: "whatsapp",
        externalId,
        uploadedBy: { kind: "contact", contactId },
        dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
      });
    } catch {
      /* best-effort: la captura nunca rompe el flujo del agente */
    }
  }

  /**
   * Embudo de Eduardo (orden fijo):
   *   pregunton → interesado → anticipo_pendiente → agendado
   * Reglas:
   *  - Los estados DUROS (anticipo_pendiente, agendado) los fijan ACCIONES
   *    reales (enviar datos bancarios, crear cita, confirmar pago), nunca la
   *    adivinanza del modelo — por eso el LLM solo puede sugerir los blandos.
   *  - "Solo avanza": jamás degrada a un lead que ya committió. Si ya está en
   *    anticipo/agendado, una nueva clasificación más baja se ignora.
   *  - seguimiento_futuro/spam son laterales: solo aplican si el lead aún no
   *    committió (rank < anticipo_pendiente).
   */
  // FUNNEL_RANK + la regla "solo avanza" viven en `./funnel` (fuente única,
  // compartida con extractAndApplyCrm de recepcionista.ts).
  async function advanceClassification(
    target: LeadClassificationValue,
    motivo?: string
  ) {
    try {
      const c = await provider.contacts.get(contactId);
      if (!canAdvanceClassification(c.leadClassification?.value, target)) return;
      await provider.contacts.classify(contactId, target, motivo);
      // Señal de aprendizaje: llegar a "agendado" = conversión real → guarda la
      // respuesta ganadora (best-effort, no bloquea el flujo).
      if (target === "agendado") {
        // Best-effort: nunca bloquea la clasificación, pero un fallo aquí
        // antes era invisible — se perdía el ejemplo "ganador" sin rastro.
        void captureAgendadoWin(instance.db, contactId).catch((err) =>
          console.warn(`[memory] captureAgendadoWin falló (contacto=${contactId}):`, err)
        );
      }
    } catch {
      /* clasificación best-effort: nunca rompe el flujo del agente */
    }
  }

  // Tools de consulta contact-independientes (catálogo, ubicación, disponibilidad).
  // Viven en shared-tools.ts y se componen aquí para que el recepcionista las
  // ofrezca igual que antes — sin duplicar código.
  const all: ToolSet = {
    ...buildSharedQueryTools({ instance }),

    consultar_expediente: tool({
      description:
        "Consulta el expediente y el historial de ESTE contacto (sus citas y pagos). Úsalo para retomar contexto antes de responder. Solo ves los datos de este contacto.",
      inputSchema: z.object({}),
      execute: async () => {
        const ctx = await provider.contacts.getContext(contactId);
        return {
          nombre: ctx.contact.nombre,
          tipo: ctx.contact.tipo,
          ciudad: ctx.contact.ciudad,
          clasificacion: ctx.contact.leadClassification?.value,
          procedimientoInteresId: ctx.contact.procedimientoInteresId,
          citas: ctx.appointments.map((a) => ({
            id: a.id,
            inicio: a.startsAt,
            estado: a.estado,
            tipo: a.tipo,
            anticipo: a.depositStatus,
          })),
          pagos: ctx.payments.map((p) => ({
            monto: p.amountMxn,
            concepto: p.concepto,
            fecha: p.createdAt,
          })),
        };
      },
    }),

    actualizar_contacto: tool({
      description:
        "Actualiza el CRM de ESTE contacto con datos confirmados en la conversación. Llámalo al cierre del turno cuando aprendas algo nuevo (nombre, ciudad, procedimiento de interés, clasificación) o cambie un hito. Escribe SOLO datos confirmados.",
      inputSchema: z.object({
        nombre: z.string().optional().describe("Nombre completo confirmado"),
        ciudad: z.string().optional(),
        procedimientoInteresId: z
          .string()
          .optional()
          .describe("id de un procedimiento del catálogo, si lo mencionó"),
        clasificacion: z
          .enum(["pregunton", "interesado", "seguimiento_futuro"])
          .optional()
          .describe(
            "Nivel de interés del lead. SOLO usa: pregunton (apenas pregunta, sin pedir agendar), interesado (pide horarios y aún con el precio sigue queriendo), seguimiento_futuro (volverá después). NO uses 'agendado' ni 'anticipo pendiente' aquí: esos se fijan solos cuando das los datos del anticipo y cuando paga.",
          ),
        convertirEnPaciente: z
          .boolean()
          .optional()
          .describe("true solo cuando ya tuvo consulta/procedimiento real"),
      }),
      execute: async ({
        nombre,
        ciudad,
        procedimientoInteresId,
        clasificacion,
        convertirEnPaciente,
      }) => {
        const partial: Record<string, unknown> = {};
        if (nombre) partial.nombre = nombre;
        if (ciudad) partial.ciudad = ciudad;
        if (procedimientoInteresId)
          partial.procedimientoInteresId = procedimientoInteresId;
        if (Object.keys(partial).length > 0)
          await provider.contacts.update(contactId, partial);
        if (clasificacion) await advanceClassification(clasificacion);
        if (convertirEnPaciente)
          await provider.contacts.convertToPatient(contactId);
        return { ok: true };
      },
    }),

    consultar_anticipos: tool({
      description:
        "Consulta la política de anticipos: si se requieren y el monto por tipo de cita. Úsalo antes de hablar de apartar fechas — sin anticipo pagado NO se confirma cita (excepto seguimiento/revisión).",
      inputSchema: z.object({}),
      execute: async () => provider.depositSettings.get(),
    }),

    enviar_datos_anticipo: tool({
      description:
        "Devuelve el monto exacto del anticipo y los datos bancarios/links de pago para compartirlos con el paciente. Di SIEMPRE el monto primero. Si no hay datos bancarios configurados, escala con escalar_a_humano.",
      inputSchema: z.object({
        tipoCita: z
          .enum([
            "valoracion_presencial",
            "valoracion_virtual",
            "seguimiento",
            "procedimiento",
          ])
          .describe("Tipo de cita para el que se pide el anticipo"),
      }),
      execute: async ({ tipoCita }) => {
        const deposit = await provider.depositSettings.get();
        const settings = await provider.settings.get();
        const rule = deposit.rules.find((r) => r.appointmentType === tipoCita);
        if (!deposit.enabled || !rule || !rule.enabled) {
          return { requiereAnticipo: false };
        }
        const hayDatos =
          settings.bankAccounts.length > 0 || settings.paymentLinks.length > 0;
        // Embudo determinista: dar los datos bancarios = "anticipo pendiente"
        // (no depende de que el modelo lo recuerde). Si no hay datos, escalará.
        if (hayDatos)
          await advanceClassification(
            "anticipo_pendiente",
            "Se le compartieron los datos del anticipo",
          );
        return {
          requiereAnticipo: true,
          montoMxn: rule.amountMxn,
          esPagoCompleto: rule.isFullPayment,
          etiqueta: rule.label,
          cuentas: settings.bankAccounts.map((b) => ({
            banco: b.banco,
            titular: b.titular,
            // CLABE completa para que el paciente pueda transferir (no la enmascarada).
            clabe: b.clabe ?? b.clabeMasked,
            tarjeta: b.tarjeta,
          })),
          linksPago: settings.paymentLinks.map((l) => ({
            label: l.label,
            url: l.url,
          })),
          sinDatosBancarios: !hayDatos,
        };
      },
    }),

    // consultar_disponibilidad: compuesta desde buildSharedQueryTools (arriba).

    crear_cita: tool({
      description:
        "Crea una cita para este contacto en un slot de consultar_disponibilidad. Queda PENDIENTE de anticipo (salvo seguimiento). Para confirmarla, el paciente debe pagar y tú usar confirmar_anticipo.",
      inputSchema: z.object({
        locationId: z.string(),
        startsAt: z.string().describe("ISO del slot elegido"),
        endsAt: z.string().describe("ISO del slot elegido"),
        tipo: z
          .enum([
            "valoracion_presencial",
            "valoracion_virtual",
            "seguimiento",
            "procedimiento",
          ])
          .describe("Tipo de cita"),
        motivo: z.string().describe("Motivo breve, ej. 'Valoración ATM'"),
      }),
      execute: async ({ locationId, startsAt, endsAt, tipo, motivo }) => {
        // ANTI-DUPLICADO: si el contacto YA tiene una cita activa, se REAGENDA
        // (mueve de horario) en vez de crear otra. Evita citas/eventos dobles.
        const ctx = await provider.contacts.getContext(contactId).catch(() => null);
        const activos = (ctx?.appointments ?? []).filter(
          (a) => !["cancelada", "completada", "no_show"].includes(a.estado)
        );
        const existente = activos
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

        let appt;
        let reagendada = false;
        if (existente) {
          appt = await provider.appointments.reschedule(
            existente.id,
            startsAt,
            endsAt,
            motivo
          );
          reagendada = true;
        } else {
          appt = await provider.appointments.create({
            patientContactId: contactId,
            locationId,
            tipo,
            startsAt,
            endsAt,
            motivo,
            isVirtual: tipo === "valoracion_virtual",
          });
        }

        // REGLA DE ORO: una cita con anticipo PENDIENTE no está confirmada y NO
        // va al Google Calendar del doctor (no le bloquea su agenda sin pago).
        // Solo las que ya no deben anticipo (no_aplica / ya pagado) se agendan
        // de verdad y se sincronizan al calendario.
        const requierePago = appt.depositStatus === "pendiente";
        if (!requierePago) {
          const push = await pushAppointmentToGoogle(
            instance.db,
            cid(),
            appt.id,
            "upsert"
          ).catch(() => ({ ok: false }) as { ok: boolean; conflict?: boolean });
          if (push.conflict) {
            await provider.appointments
              .cancel(appt.id, "Horario ocupado en el calendario")
              .catch(() => {});
            return {
              ok: false,
              motivo: "horario_ocupado",
              nota: "Ese horario ya se ocupó. Usa consultar_disponibilidad y ofrece otro.",
            };
          }
          await advanceClassification("agendado", "Cita confirmada");
          await notify(
            "nueva_cita",
            reagendada ? "Cita reagendada" : "Nueva cita agendada",
            `${motivo} · ${startsAt}`,
            appt.id
          );
        } else {
          await advanceClassification(
            "anticipo_pendiente",
            "Cita registrada, pendiente de anticipo"
          );
        }

        return {
          citaId: appt.id,
          estado: appt.estado,
          depositStatus: appt.depositStatus,
          reagendada,
          nota: requierePago
            ? "Cita registrada como PENDIENTE de anticipo (NO está agendada ni confirmada todavía, NO está en el calendario del doctor). Dile al paciente que aparta su lugar enviando el comprobante del anticipo; SOLO cuando lo valides con confirmar_anticipo queda agendada. NUNCA le digas que su cita ya quedó agendada o confirmada."
            : reagendada
              ? "Cita reagendada y confirmada."
              : "Cita confirmada.",
        };
      },
    }),

    confirmar_anticipo: tool({
      description:
        "Lee el comprobante de pago (imagen) que envió el paciente, lo PREVALIDA (monto y legibilidad) y lo deja EN REVISIÓN del equipo. La cita NO queda confirmada hasta que una persona confirme el anticipo en el panel. Úsalo cuando el paciente mande un comprobante para una cita pendiente.",
      inputSchema: z.object({
        citaId: z.string().describe("id de la cita pendiente de anticipo"),
        comprobanteUrl: z
          .string()
          .describe("URL de la imagen del comprobante que envió el paciente"),
      }),
      execute: async ({ citaId, comprobanteUrl }) => {
        // GUARDA DE ORDEN (embudo determinista): no se puede "confirmar anticipo"
        // sin una cita real pendiente — eso obliga a que crear_cita haya ocurrido
        // antes (impide que un modelo se salte ese paso). Es barato: corta ANTES
        // de gastar la llamada de visión.
        const apptPre = await provider.appointments.get(citaId).catch(() => null);
        if (!apptPre) {
          return {
            ok: false,
            motivo: "cita_no_encontrada",
            nota: "No encuentro esa cita. Primero aparta el lugar con crear_cita y luego confirma el anticipo con el id que devuelva.",
          };
        }
        // Tool contact-scoped: el comprobante solo puede aplicar a una cita de
        // ESTE contacto (no a la de otro paciente de la clínica).
        if (
          apptPre.patientContactId &&
          apptPre.patientContactId !== contactId
        ) {
          return {
            ok: false,
            motivo: "cita_de_otro_contacto",
            nota: "Esa cita no pertenece a este contacto. Verifica el id de SU cita (consultar_expediente) antes de aplicar el comprobante.",
          };
        }
        if (apptPre.estado === "confirmada" || apptPre.depositStatus === "pagado") {
          // Idempotente: ya estaba pagada/confirmada — no vuelvas a pedir comprobante.
          return {
            ok: true,
            yaConfirmada: true,
            estadoCita: apptPre.estado,
            nota: "Esa cita ya está confirmada con su anticipo. No vuelvas a pedir comprobante; solo confírmale al paciente fecha y hora.",
          };
        }
        // Idempotente sobre la PROPUESTA (Capa 5): si ya hay un pago pendiente
        // de revisión para esta cita, no re-gastes visión ni dupliques la
        // propuesta — el equipo ya la tiene en el panel.
        const yaPendiente = (
          await provider.payments.list({ appointmentId: citaId })
        ).find((p) => p.status === "pendiente");
        if (yaPendiente) {
          return {
            ok: true,
            pendienteRevision: true,
            yaEnRevision: true,
            nota: "El comprobante de esa cita YA está en revisión del equipo. Dile al paciente que en cuanto lo validen le confirmamos por aquí. NO afirmes que la cita ya está confirmada.",
          };
        }

        // Resuelve la imagen UNA vez: wa-media → bytes (token-gated), http(s) →
        // allowlist anti-SSRF. Reusa los mismos bytes/URL para visión Y captura.
        const resolved = await resolveToolImage(comprobanteUrl);
        if (!resolved) {
          return {
            ok: false,
            motivo: "url_no_permitida",
            nota: "No pude leer ese comprobante (host no permitido o no se pudo descargar). Pide que lo reenvíe.",
          };
        }
        let lectura;
        try {
          const { object } = await generateObject({
            model: resolveVisionModel(),
            schema: z.object({
              esComprobante: z
                .boolean()
                .describe("¿La imagen es un comprobante de pago/transferencia?"),
              montoMxn: z
                .number()
                .nullable()
                .describe("Monto en pesos que muestra el comprobante"),
              referencia: z.string().nullable(),
              legible: z.boolean(),
            }),
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Analiza esta imagen. ¿Es un comprobante de pago o transferencia bancaria? Extrae el monto exacto en MXN y la referencia/folio. Si no se distingue con claridad, legible=false.",
                  },
                  { type: "image", image: resolved.image },
                ],
              },
            ],
          });
          lectura = object;
        } catch {
          return {
            ok: false,
            motivo: "no_se_pudo_leer",
            nota: "No pude leer el comprobante. Pide una captura más clara.",
          };
        }

        if (!lectura.esComprobante || !lectura.legible || !lectura.montoMxn) {
          return {
            ok: false,
            motivo: "comprobante_invalido",
            nota: "El comprobante no se ve claro o no muestra el monto. Pide otra captura.",
          };
        }

        const appt = await provider.appointments.get(citaId);
        if (appt.depositAmountMxn && lectura.montoMxn < appt.depositAmountMxn) {
          return {
            ok: false,
            motivo: "monto_insuficiente",
            nota: `Monto insuficiente. Requiere $${appt.depositAmountMxn} MXN, recibiste $${lectura.montoMxn} MXN. Diferencia: $${appt.depositAmountMxn - lectura.montoMxn} MXN.`,
          };
        }
        const concepto: PaymentConcept =
          appt.tipo === "valoracion_virtual"
            ? "pago_completo_virtual"
            : appt.tipo === "procedimiento"
              ? "apartado_cirugia"
              : "anticipo_valoracion";

        // Capa 5 (decisión de producto): la IA PREVALIDA pero NO registra
        // dinero. El pago nace "pendiente" y una persona lo confirma en el
        // panel (payments.confirm) — ahí es donde la cita se confirma, se
        // avanza el embudo y se empuja a Google Calendar (efecto RPC).
        await provider.payments.register({
          patientContactId: contactId,
          appointmentId: citaId,
          concepto,
          amountMxn: lectura.montoMxn,
          method: "transferencia",
          reference: lectura.referencia ?? undefined,
          receiptUrl: comprobanteUrl,
          status: "pendiente",
        });
        // Avisa al equipo que hay un anticipo prevalidado esperando su OK.
        await notify(
          "comprobante_recibido",
          "🧾 Anticipo por confirmar",
          `[prevalidado IA] Comprobante por $${lectura.montoMxn} MXN` +
            (appt.depositAmountMxn
              ? ` (requerido $${appt.depositAmountMxn})`
              : "") +
            (lectura.referencia ? ` · ref ${lectura.referencia}` : "") +
            " · el monto cubre el anticipo. Confírmalo en Agenda para registrar el pago y confirmar la cita.",
          citaId
        );
        // Captura el comprobante validado como Asset (→ MinIO), ligado a la cita.
        // Solo si bajamos bytes reales (wa-media); best-effort, no bloquea la
        // respuesta que el paciente está esperando.
        if (resolved.bytes && resolved.mediaId) {
          void captureImageAsset(resolved.bytes, "ticket_gasto", resolved.mediaId, {
            appointmentId: citaId,
          });
        }
        return {
          ok: true,
          pendienteRevision: true,
          montoDetectado: lectura.montoMxn,
          estadoCita: appt.estado,
          nota: "Comprobante recibido y prevalidado; el pago quedó EN REVISIÓN del equipo. Dile al paciente que recibimos su comprobante y que le confirmamos su cita en cuanto el equipo valide el anticipo. NO digas que la cita ya quedó confirmada ni des por hecho el pago.",
        };
      },
    }),

    reagendar_cita: tool({
      description:
        "Mueve una cita existente de este contacto a un nuevo horario (de consultar_disponibilidad). Usa consultar_mis_citas para obtener el id.",
      inputSchema: z.object({
        citaId: z.string(),
        startsAt: z.string().describe("ISO del nuevo inicio"),
        endsAt: z.string().describe("ISO del nuevo fin"),
        motivo: z.string().optional(),
      }),
      execute: async ({ citaId, startsAt, endsAt, motivo }) => {
        const appt = await provider.appointments.reschedule(
          citaId,
          startsAt,
          endsAt,
          motivo
        );
        await pushAppointmentToGoogle(instance.db, cid(), citaId, "upsert").catch(
          () => {}
        );
        await notify(
          "reagenda",
          "Cita reagendada",
          `${appt.titulo ?? appt.motivo} → ${startsAt}`,
          citaId
        );
        return { ok: true, estado: appt.estado, nuevoInicio: appt.startsAt };
      },
    }),

    cancelar_cita: tool({
      description:
        "Cancela una cita existente de este contacto. Pide confirmación explícita antes de cancelar. Usa consultar_mis_citas para obtener el id.",
      inputSchema: z.object({
        citaId: z.string(),
        motivo: z.string().optional(),
      }),
      execute: async ({ citaId, motivo }) => {
        // GUARDA DE ESTADO: solo se cancela una cita "viva". Cancelar una cita ya
        // completada / cancelada / no_show corrompería su estado y emitiría un
        // evento `cita_cancelada` espurio (afecta ledger y profiles).
        const actual = await provider.appointments.get(citaId).catch(() => null);
        if (!actual) {
          return {
            ok: false,
            motivo: "cita_no_encontrada",
            nota: "No encuentro esa cita. Usa consultar_mis_citas para obtener el id correcto.",
          };
        }
        const noCancelables = ["completada", "cancelada", "no_show"];
        if (noCancelables.includes(actual.estado)) {
          return {
            ok: false,
            motivo: "estado_no_cancelable",
            estado: actual.estado,
            nota: `Esa cita está en estado "${actual.estado}" y ya no se puede cancelar. No emitas una cancelación; explícale al paciente su estado actual.`,
          };
        }
        const appt = await provider.appointments.cancel(citaId, motivo);
        await pushAppointmentToGoogle(instance.db, cid(), citaId, "delete").catch(
          () => {}
        );
        await notify(
          "cancelacion",
          "Cita cancelada",
          `${appt.titulo ?? appt.motivo} · ${appt.startsAt}`,
          citaId
        );
        return { ok: true, estado: appt.estado };
      },
    }),

    consultar_mis_citas: tool({
      description:
        "Lista las citas de ESTE contacto (para reagendar, cancelar o recordar). Solo las suyas.",
      inputSchema: z.object({}),
      execute: async () => {
        const citas = await provider.appointments.listForContact(contactId);
        return citas.map((a) => ({
          id: a.id,
          inicio: a.startsAt,
          fin: a.endsAt,
          estado: a.estado,
          tipo: a.tipo,
          motivo: a.motivo,
        }));
      },
    }),

    clasificar_lead: tool({
      description:
        "Clasifica la INTENCIÓN del lead. Solo tres opciones: 'pregunton' = apenas pregunta (precio, info) y aún no pide agendar — es el default de todos al entrar; 'interesado' = ya pidió horarios y, aun habiéndole dado el precio, sigue queriendo avanzar; 'seguimiento_futuro' = dijo que volverá más adelante. NO clasifiques 'anticipo pendiente' ni 'agendado': esos se marcan SOLOS cuando le das los datos del anticipo y cuando paga. Nunca degradas a alguien que ya avanzó.",
      inputSchema: z.object({
        clasificacion: z.enum([
          "pregunton",
          "interesado",
          "seguimiento_futuro",
        ]),
        motivo: z.string().describe("Por qué lo clasificas así, en una frase"),
      }),
      execute: async ({ clasificacion, motivo }) => {
        await advanceClassification(clasificacion, motivo);
        const contact = await provider.contacts.get(contactId);
        return { ok: true, clasificacion: contact.leadClassification?.value };
      },
    }),

    prevaloracion_por_fotos: tool({
      description:
        "Analiza las fotos clínicas que envió el paciente para una pre-valoración sin costo y deja un resumen para el doctor. Úsalo solo cuando el paciente lo pidió y mandó fotos.",
      inputSchema: z.object({
        fotosUrls: z
          .array(z.string())
          .describe("URLs de las fotos clínicas enviadas"),
        datosClinicos: z
          .string()
          .optional()
          .describe("Datos que dio el paciente (motivo, edad, etc.)"),
      }),
      execute: async ({ fotosUrls, datosClinicos }) => {
        // Resuelve cada foto: wa-media → bytes (token-gated), http(s) → allowlist
        // anti-SSRF. Reusa los mismos bytes para visión Y captura (sin 2ª descarga).
        const resueltas = (
          await Promise.all(fotosUrls.map((u) => resolveToolImage(u)))
        ).filter((r): r is NonNullable<typeof r> => r !== null);
        if (resueltas.length === 0) {
          return {
            ok: false,
            nota: `No pude leer las fotos (hosts no permitidos o no se pudieron descargar). Pide que las reenvíe por aquí.`,
          };
        }
        let resumen = "";
        try {
          const { object } = await generateObject({
            model: resolveVisionModel(),
            schema: z.object({
              resumenParaDoctor: z.string(),
              hallazgosVisibles: z.array(z.string()),
            }),
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `Eres asistente clínico dental. Resume de forma objetiva lo visible en estas fotos para que el doctor dé un rango aproximado. NO diagnostiques ni prometas resultados. Datos del paciente: ${datosClinicos ?? "no especificados"}.`,
                  },
                  ...resueltas.map((r) => ({
                    type: "image" as const,
                    image: r.image,
                  })),
                ],
              },
            ],
          });
          resumen = object.resumenParaDoctor;
        } catch {
          resumen = "El paciente envió fotos para pre-valoración (no se pudieron analizar automáticamente).";
        }
        await notify(
          "prevaloracion_lista",
          "Pre-valoración por fotos lista",
          resumen,
          undefined
        );
        // Captura cada foto con bytes como expediente clínico (→ MinIO). Best-effort,
        // dedup por wa-media id (idempotente con la captura del webhook entrante).
        for (const r of resueltas) {
          if (r.bytes && r.mediaId) void captureImageAsset(r.bytes, "foto_clinica", r.mediaId);
        }
        const faltaron = fotosUrls.length - resueltas.length;
        return {
          ok: true,
          fotosAnalizadas: resueltas.length,
          fotosSolicitadas: fotosUrls.length,
          nota:
            faltaron > 0
              ? `Pre-valoración registrada (solo pude leer ${resueltas.length} de ${fotosUrls.length} fotos; ${faltaron} no se descargaron). Dile al paciente que el doctor revisará y, si hace falta, pídele reenviar las que faltaron.`
              : "Pre-valoración registrada y enviada al doctor. Dile al paciente que el doctor revisará y le compartirá un rango aproximado en breve.",
        };
      },
    }),

    registrar_referido: tool({
      description:
        "Registra que este lead llegó referido por alguien y avisa al doctor.",
      inputSchema: z.object({
        referidoPor: z.string().describe("Quién lo refirió"),
        contexto: z.string().optional(),
      }),
      execute: async ({ referidoPor, contexto }) => {
        await notify(
          "referido",
          "Lead referido",
          `Referido por ${referidoPor}. ${contexto ?? ""}`.trim()
        );
        return { ok: true };
      },
    }),

    notificar_doctor: tool({
      description:
        "Avisa al doctor/equipo de un evento que requiere su atención. Úsalo para: paciente con duda médica de su caso, lead que pide hablar con el doctor, o algo fuera de tu alcance.",
      inputSchema: z.object({
        tipo: z.enum([
          "paciente_escribe",
          "lead_pide_doctor",
          "lead_fuera_alcance",
        ]),
        resumen: z.string().describe("Qué pasó, en una frase"),
      }),
      execute: async ({ tipo, resumen }) => {
        const titles: Record<string, string> = {
          paciente_escribe: "Un paciente escribió",
          lead_pide_doctor: "Un lead quiere hablar contigo",
          lead_fuera_alcance: "Solicitud fuera de alcance",
        };
        await notify(tipo as NotificationType, titles[tipo] ?? "Aviso", resumen);
        return { ok: true };
      },
    }),

    escalar_a_humano: tool({
      description:
        "Pasa la conversación a atención humana y deja de responder. Úsalo SIEMPRE que: pidan al doctor, haya tema médico delicado, queja, o algo fuera de tu alcance. Despídete cálidamente.",
      inputSchema: z.object({
        motivo: z.string().describe("Por qué escalas, en una frase"),
        tipo: z
          .enum(["paciente_escribe", "lead_pide_doctor", "lead_fuera_alcance"])
          .optional(),
      }),
      execute: async ({ motivo, tipo }) => {
        // Pasa a atención humana por 24 h (luego la IA retoma sola si nadie cambia nada).
        await provider.conversations.setIaState(conversationId, "humano", {
          pausedUntil: new Date(
            Date.parse(instance.db.now()) + 24 * 60 * 60_000
          ).toISOString(),
        });
        await notify(
          (tipo as NotificationType) ?? "lead_pide_doctor",
          "Conversación escalada",
          motivo
        );
        // Accountability: la escalación es la fuente de verdad del banner del inbox.
        // Si NO se pudo registrar, lo decimos (ok:false) en vez de afirmar que el
        // equipo ya fue avisado — el agente no debe dar por hecho lo que no pasó.
        try {
          const esc = await instance.provider.escalations.create({
            conversationId,
            contactId,
            tipo: tipo ?? "lead_pide_doctor",
            motivo,
          });
          return {
            ok: true,
            escalationId: esc.id,
            nota: "Conversación en modo humano. Despídete indicando que el doctor o una persona del equipo continuará en breve.",
          };
        } catch {
          return {
            ok: false,
            error: "no se pudo registrar la escalación",
            nota: "No confirmes al paciente que ya avisaste; di que en breve lo atienden y reintenta.",
          };
        }
      },
    }),

    escalar_urgente: tool({
      description:
        "Handoff URGENTE a un humano para casos sensibles que NO pueden esperar: tema quirúrgico o post-operatorio, problema con un pago/comprobante/anticipo que no puedes resolver, o una queja seria. Pasa la conversación a atención humana y avisa al equipo con prioridad. Despídete cálidamente indicando que una persona del equipo continuará enseguida.",
      inputSchema: z.object({
        motivo: z
          .string()
          .describe("Por qué es urgente, en una frase (quirúrgico/pago/queja)"),
      }),
      execute: async ({ motivo }) => {
        await provider.conversations.setIaState(conversationId, "humano", {
          pausedUntil: new Date(
            Date.parse(instance.db.now()) + 24 * 60 * 60_000
          ).toISOString(),
        });
        // Notificación URGENTE (la política la marca urgente → ignora horario
        // silencioso y resalta en la campana).
        await notify(
          "escalacion_handoff",
          "🆘 Escalación urgente",
          motivo
        );
        try {
          const esc = await instance.provider.escalations.create({
            conversationId,
            contactId,
            tipo: "escalacion_handoff",
            urgencia: "urgente",
            motivo,
          });
          return {
            ok: true,
            escalationId: esc.id,
            nota: "Caso urgente en manos del equipo. Despídete diciendo que una persona continuará enseguida.",
          };
        } catch {
          return {
            ok: false,
            error: "no se pudo registrar la escalación urgente",
            nota: "No confirmes que ya avisaste; di que en breve lo atienden y reintenta.",
          };
        }
      },
    }),

    mover_a_blacklist: tool({
      description:
        "Mueve a este contacto a la lista negra (spam/abuso) y deja de atenderlo. Úsalo solo en spam claro o abuso.",
      inputSchema: z.object({
        motivo: z.string(),
      }),
      execute: async ({ motivo }) => {
        const contact = await provider.contacts.get(contactId);
        await provider.blacklist
          .add({ phone: contact.whatsappPhone, contactId, motivo })
          .catch(() => {});
        await provider.conversations
          .setIaState(conversationId, "pausada")
          .catch(() => {});
        return { ok: true };
      },
    }),
  };

  return filterTools(all, enabledTools);
}

/**
 * Alias de compatibilidad — conserva el nombre anterior para que los
 * call-sites existentes (recepcionista.ts, tests manuales, etc.) no necesiten
 * cambiar en esta etapa. Apunta directamente a `buildContactScopedTools`.
 *
 * @deprecated Usa `buildContactScopedTools` en código nuevo.
 */
export const buildRecepcionistaTools = buildContactScopedTools;

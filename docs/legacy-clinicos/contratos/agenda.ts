/**
 * Dominio de agenda, sedes y pagos de ClinicOS.
 * Cubre la gestión completa de citas médicas, horarios, anticipos y catálogo de procedimientos.
 */

import { z } from "zod";
import {
  IsoDateTimeSchema,
  IsoDateSchema,
  MoneyMxnSchema,
  ActorSchema,
  ExternalSourceSchema,
} from "./shared";
import { ProcedureKindSchema, ProcedureFichaSchema } from "./journey";

// ——— Enums ———

export const LocationModeSchema = z.enum(["permanente", "jornada_especial"]);
export type LocationMode = z.infer<typeof LocationModeSchema>;

export const AppointmentTypeSchema = z.enum([
  "valoracion_presencial",
  "valoracion_virtual",
  "seguimiento",
  "procedimiento",
  // Bloqueo de horario sin paciente (comida, junta, quirófano ocupado, día
  // personal). Ocupa el slot en la agenda igual que una cita, pero no tiene
  // paciente ni anticipo. Ver `patientContactId` opcional + refine abajo.
  "bloqueo",
]);
export type AppointmentType = z.infer<typeof AppointmentTypeSchema>;

export const AppointmentStatusSchema = z.enum([
  "nueva",
  "confirmada",
  "reagendada",
  "cancelada",
  "completada",
  "no_show",
]);
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;

export const DepositStatusSchema = z.enum([
  "no_aplica",
  "pendiente",
  "pagado",
  "vencido",
]);
export type DepositStatus = z.infer<typeof DepositStatusSchema>;

export const PaymentConceptSchema = z.enum([
  "anticipo_valoracion",
  "pago_completo_virtual",
  "apartado_cirugia",
  "liquidacion",
  "abono",
  "otro",
]);
export type PaymentConcept = z.infer<typeof PaymentConceptSchema>;

export const PaymentMethodSchema = z.enum([
  "transferencia",
  "tarjeta",
  "efectivo",
  "link_pago",
]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PaymentStatusSchema = z.enum([
  "pendiente",
  "confirmado",
  "reembolsado",
  "abonado_a_tratamiento",
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const CatalogIntakeStatusSchema = z.enum([
  "pendiente",
  "confirmado",
  "descartado",
]);
export type CatalogIntakeStatus = z.infer<typeof CatalogIntakeStatusSchema>;

// ——— Sedes y horarios ———

/**
 * Sede física o virtual donde opera la clínica.
 * Patrón real validado: sede permanente (ej. Guadalajara) + jornadas especiales (ej. Tuxtla 4 días).
 */
export const LocationSchema = z.object({
  id: z.string(),
  clinicId: z.string(),
  nombre: z.string(),
  ciudad: z.string(),
  direccion: z.string(),
  /** URL de Google Maps para compartir ubicación con pacientes. */
  mapsUrl: z.string().optional(),
  isPrimary: z.boolean(),
  mode: LocationModeSchema,
});
export type Location = z.infer<typeof LocationSchema>;

/** Rango de apertura y cierre dentro de un día (formato "HH:mm"). */
export const DayRangeSchema = z.object({
  /** Hora de apertura, ej. "08:00". */
  open: z.string(),
  /** Hora de cierre, ej. "14:00". */
  close: z.string(),
});
export type DayRange = z.infer<typeof DayRangeSchema>;

/** Horarios de atención para un día de la semana. */
export const WeekDayHoursSchema = z.object({
  /** Día de la semana: 0=domingo, 1=lunes … 6=sábado. */
  day: z.number().min(0).max(6),
  ranges: z.array(DayRangeSchema),
});
export type WeekDayHours = z.infer<typeof WeekDayHoursSchema>;

/** Horario semanal completo de una sede. */
export const OpeningHoursSchema = z.object({
  /** id de la Location (loc_) a la que pertenece este horario. */
  locationId: z.string(),
  week: z.array(WeekDayHoursSchema),
});
export type OpeningHours = z.infer<typeof OpeningHoursSchema>;

/**
 * Horario de atención DE UN DOCTOR en una sede (entidad de primera clase,
 * distinta del `OpeningHours` de la sede).
 *
 * Por qué existe: en clínicas de un solo consultorio compartido por varios
 * doctores (caso becerril), la disponibilidad NO es por-sede sino por-doctor —
 * cada doctor atiende su propia ventana, con su propia duración de cita y sin
 * mañanas. Si una clínica no define `DoctorSchedule`, la disponibilidad cae al
 * `OpeningHours` de la sede (comportamiento por defecto, retrocompatible).
 */
export const DoctorScheduleSchema = z.object({
  id: z.string(),
  clinicId: z.string(),
  /** id del usuario doctor (usr_) dueño de este horario. */
  doctorUserId: z.string(),
  /** id de la Location (loc_) donde aplica este horario. */
  locationId: z.string(),
  /** Duración de cada cita/slot en minutos (ej. 40 para Andrei). */
  slotMinutes: z.number(),
  /** Ventana semanal de atención del doctor (reusa WeekDayHours). */
  week: z.array(WeekDayHoursSchema),
  /** Antelación mínima para agendar, en horas (ej. 2h). Para enforcement futuro. */
  minLeadHours: z.number().optional(),
  /** Tolerancia de llegada en minutos (ej. 15). Para enforcement futuro. */
  toleranceMin: z.number().optional(),
  /** false = el horario existe pero no se usa (cae al fallback de sede). */
  active: z.boolean(),
});
export type DoctorSchedule = z.infer<typeof DoctorScheduleSchema>;

/**
 * Ventana de política de agenda para una sede en un rango de fechas.
 * LA POLÍTICA decide si se ofrece una sede/fecha; el calendario solo aporta horas libres dentro de lo autorizado.
 */
export const SchedulePolicyWindowSchema = z.object({
  id: z.string(),
  clinicId: z.string(),
  /** id de la Location (loc_) a la que aplica esta política. */
  locationId: z.string(),
  /** Fecha de inicio del rango de vigencia (YYYY-MM-DD). */
  from: IsoDateSchema,
  /** Fecha de fin del rango de vigencia (YYYY-MM-DD). */
  to: IsoDateSchema,
  /** true = la sede está disponible para agendar en ese rango; false = bloqueada. */
  allowed: z.boolean(),
  nota: z.string().optional(),
});
export type SchedulePolicyWindow = z.infer<typeof SchedulePolicyWindowSchema>;

// ——— Citas ———

/** Registro histórico de un reagendamiento: fecha anterior, nueva fecha, quién y cuándo lo hizo. */
export const RescheduleEntrySchema = z.object({
  fromStartsAt: IsoDateTimeSchema,
  toStartsAt: IsoDateTimeSchema,
  /** Momento en que se realizó el reagendamiento. */
  at: IsoDateTimeSchema,
  by: ActorSchema,
  motivo: z.string().optional(),
});
export type RescheduleEntry = z.infer<typeof RescheduleEntrySchema>;

/**
 * Cita médica agendada en la plataforma.
 * REGLA DE ORO: una cita con anticipo requerido NO se confirma hasta que depositStatus=pagado.
 */
export const AppointmentSchema = z.object({
  id: z.string(),
  clinicId: z.string(),
  /**
   * id del Contact (cont_) paciente dueño de la cita. Opcional SOLO para citas
   * de tipo "bloqueo" (horario reservado sin paciente). Para cualquier otro
   * tipo es obligatorio — lo garantiza el `.refine()` al cierre del schema.
   */
  patientContactId: z.string().optional(),
  /** id de la Location (loc_) donde se realizará la cita. */
  locationId: z.string(),
  /** id del usuario doctor (usr_) asignado a la cita. */
  doctorUserId: z.string().optional(),
  /** id del evento en Google Calendar sincronizado con esta cita. */
  calendarEventId: z.string().optional(),
  /**
   * Id de esta cita en el sistema externo de origen (p. ej. un externalId
   * derivado de Notion, o el calendarEventId de GCal). Junto con `source` es la
   * llave de idempotencia de migración; evita duplicar citas en re-runs.
   */
  externalId: z.string().optional(),
  /** Sistema externo del que se importó o con el que se sincroniza la cita. */
  source: ExternalSourceSchema.optional(),
  tipo: AppointmentTypeSchema,
  /**
   * Estado actual de la cita.
   * REGLA DE ORO: pasar a "confirmada" solo cuando depositStatus=pagado (si aplica anticipo).
   */
  estado: AppointmentStatusSchema,
  /** Fecha y hora de inicio de la cita. */
  startsAt: IsoDateTimeSchema,
  /** Fecha y hora de fin de la cita. */
  endsAt: IsoDateTimeSchema,
  /** Título de la cita; se usa como summary del evento de Google Calendar. */
  titulo: z.string().optional(),
  /** true = cita virtual (sin dirección física; se crea liga de Google Meet). */
  isVirtual: z.boolean().optional(),
  /** Ubicación física de la cita (default = dirección del consultorio). */
  ubicacion: z.string().optional(),
  /** Motivo principal de consulta o procedimiento. */
  motivo: z.string(),
  /** id del Procedure (proc_) asociado si la cita es de tipo procedimiento. */
  procedimientoId: z.string().optional(),
  /**
   * Estado del anticipo requerido para confirmar la cita.
   * REGLA DE ORO: la cita no pasa a "confirmada" hasta que este campo sea "pagado".
   */
  depositStatus: DepositStatusSchema,
  depositAmountMxn: MoneyMxnSchema.optional(),
  /** id del Payment (pay_) que corresponde al anticipo cobrado. */
  depositPaymentId: z.string().optional(),
  rescheduleHistory: z.array(RescheduleEntrySchema),
  /**
   * true = la cita necesita revisión humana antes de operarse: típicamente un
   * evento que nació en Google Calendar y el sistema no pudo resolver de qué
   * paciente es o le falta información. Visible (no se esconde), pero marcada.
   */
  needsReview: z.boolean().optional(),
  /** Motivo legible de por qué quedó "por revisar" (ej. "Sin coincidencia de paciente"). */
  reviewReason: z.string().optional(),
  /**
   * Último error al sincronizar HACIA Google Calendar (ClinicOS → Google). Si
   * está presente, el push no se concretó (ej. "Horario ocupado en Google",
   * "Reconecta Google"). undefined = sin error conocido. NO se inventa: lo
   * setea el push saliente para que el fallo deje de ser invisible.
   */
  googleSyncError: z.string().optional(),
  createdBy: ActorSchema,
  createdAt: IsoDateTimeSchema,
}).refine((a) => a.tipo === "bloqueo" || a.needsReview || a.patientContactId != null, {
  message: "patientContactId es obligatorio salvo en citas de tipo 'bloqueo' o 'por revisar'",
  path: ["patientContactId"],
});
export type Appointment = z.infer<typeof AppointmentSchema>;

// ——— Configuración de anticipos ———

/** Regla de anticipo para un tipo específico de cita. */
export const DepositRuleSchema = z.object({
  appointmentType: AppointmentTypeSchema,
  enabled: z.boolean(),
  amountMxn: MoneyMxnSchema,
  /** true = se cobra el total al agendar (ej. valoración virtual); false = es solo un anticipo parcial. */
  isFullPayment: z.boolean(),
  /** Etiqueta visible al paciente, ej. "Anticipo para valoración". */
  label: z.string(),
});
export type DepositRule = z.infer<typeof DepositRuleSchema>;

/**
 * Configuración global de anticipos de la clínica.
 * TODO monto de anticipo en la app y en los agentes viene de aquí — nunca hardcodeado.
 */
export const DepositSettingsSchema = z.object({
  clinicId: z.string(),
  /** Interruptor global: si false, ningún tipo de cita requiere anticipo. */
  enabled: z.boolean(),
  rules: z.array(DepositRuleSchema),
  notas: z.string().optional(),
});
export type DepositSettings = z.infer<typeof DepositSettingsSchema>;

// ——— Pagos ———

/** Registro de un pago recibido o aplicado a una cita o tratamiento. */
export const PaymentSchema = z.object({
  id: z.string(),
  clinicId: z.string(),
  /** id del Contact (cont_) paciente que realizó el pago. */
  patientContactId: z.string(),
  /** id de la Appointment (apt_) a la que aplica este pago, si corresponde. */
  appointmentId: z.string().optional(),
  concepto: PaymentConceptSchema,
  amountMxn: MoneyMxnSchema,
  method: PaymentMethodSchema,
  status: PaymentStatusSchema,
  /**
   * Id de este pago en el sistema externo de origen (externalId derivado,
   * p. ej. `notion:<page>:anticipo`). Junto con `source` es la llave de
   * idempotencia de migración; evita duplicar pagos en re-runs.
   */
  externalId: z.string().optional(),
  /** Sistema externo del que se importó este pago. */
  source: ExternalSourceSchema.optional(),
  /** Número de referencia bancaria o folio de pago. */
  reference: z.string().optional(),
  /** URL del comprobante de pago (imagen o PDF). */
  receiptUrl: z.string().optional(),
  /** Fecha y hora en que se confirmó el pago. */
  paidAt: IsoDateTimeSchema.optional(),
  registeredBy: ActorSchema,
  createdAt: IsoDateTimeSchema,
});
export type Payment = z.infer<typeof PaymentSchema>;

// ——— Catálogo de procedimientos ———

/**
 * Procedimiento médico o estético ofrecido por la clínica.
 * Sirve como base de precios y contexto para los agentes de venta.
 */
export const ProcedureSchema = z.object({
  id: z.string(),
  clinicId: z.string(),
  nombre: z.string(),
  categoria: z.string(),
  priceMinMxn: MoneyMxnSchema,
  priceMaxMxn: MoneyMxnSchema.optional(),
  /** Duración estimada del procedimiento en minutos. */
  durationMin: z.number().optional(),
  requiresQuirofano: z.boolean(),
  /** Monto de anticipo especial para este procedimiento, ej. apartado de cirugía. Sobreescribe la regla general. */
  depositOverrideMxn: MoneyMxnSchema.optional(),
  activo: z.boolean(),
  descripcion: z.string().optional(),
  /** Contexto para los agentes de venta: objeciones típicas, qué resaltar al paciente. */
  notasVenta: z.string().optional(),
  /**
   * Clase del procedimiento (genérica, NO anclada en "operatorio"): dicta el
   * journey y las banderas rojas del agente de pacientes. Si se omite, se deriva
   * de `requiresQuirofano`. Ver `ProcedureKind` en ./journey.
   */
  tipo: ProcedureKindSchema.optional(),
  /**
   * Ficha de cuidado aprobada por el doctor (camino C parte "a"): lo normal por
   * etapa, cuidados, preparación y banderas rojas. El agente de pacientes la
   * relaya dentro de su alcance seguro. Ver `ProcedureFicha` en ./journey.
   */
  ficha: ProcedureFichaSchema.optional(),
  updatedAt: IsoDateTimeSchema,
});
export type Procedure = z.infer<typeof ProcedureSchema>;

/** Borrador de procedimiento propuesto por el asistente IA durante un intake de catálogo. */
export const CatalogProcedureDraftSchema = z.object({
  nombre: z.string(),
  categoria: z.string(),
  priceMinMxn: MoneyMxnSchema,
  priceMaxMxn: MoneyMxnSchema.optional(),
  notasVenta: z.string().optional(),
});
export type CatalogProcedureDraft = z.infer<typeof CatalogProcedureDraftSchema>;

/**
 * Sesión de intake del catálogo de procedimientos asistida por IA.
 * El doctor describe sus procedimientos hablando y la IA propone borradores estructurados.
 */
export const CatalogIntakeDraftSchema = z.object({
  id: z.string(),
  clinicId: z.string(),
  /** Transcripción o dictado original del doctor sobre sus procedimientos. */
  sourceText: z.string(),
  procedures: z.array(CatalogProcedureDraftSchema),
  status: CatalogIntakeStatusSchema,
  createdAt: IsoDateTimeSchema,
});
export type CatalogIntakeDraft = z.infer<typeof CatalogIntakeDraftSchema>;

// ——— Filtros y auxiliares ———

/** Filtros para consultar citas en la agenda. */
export const AgendaFiltersSchema = z.object({
  /** id de la Location (loc_) por la que filtrar. */
  locationId: z.string().optional(),
  /** id del usuario doctor (usr_) por el que filtrar. */
  doctorUserId: z.string().optional(),
  tipo: AppointmentTypeSchema.optional(),
  estado: AppointmentStatusSchema.optional(),
});
export type AgendaFilters = z.infer<typeof AgendaFiltersSchema>;

/** Slot de disponibilidad devuelto por el motor de agenda. */
export const AvailabilitySlotSchema = z.object({
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
  /** id de la Location (loc_) donde está disponible el slot. */
  locationId: z.string(),
  /** id del doctor (usr_) cuyo horario generó el slot, si fue por-doctor. */
  doctorUserId: z.string().optional(),
});
export type AvailabilitySlot = z.infer<typeof AvailabilitySlotSchema>;

/** Payload para crear una nueva cita. */
export const CreateAppointmentInputSchema = z.object({
  /**
   * id del Contact (cont_) paciente para quien se agenda. Opcional SOLO para
   * `tipo === "bloqueo"` (horario reservado sin paciente). Requerido en
   * cualquier otro tipo — lo garantiza el `.refine()` al cierre del schema.
   */
  patientContactId: z.string().optional(),
  /** id de la Location (loc_) donde se realizará la cita. */
  locationId: z.string(),
  /** id del usuario doctor (usr_) asignado. */
  doctorUserId: z.string().optional(),
  tipo: AppointmentTypeSchema,
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
  /** Título de la cita; default "<paciente> | <motivo>", editable. Para un
   * bloqueo es la etiqueta visible (ej. "Comida", "Quirófano ocupado"). */
  titulo: z.string().optional(),
  /** true = cita virtual (sin dirección; genera liga de Google Meet). */
  isVirtual: z.boolean().optional(),
  /** Ubicación física (default = dirección del consultorio). */
  ubicacion: z.string().optional(),
  motivo: z.string(),
  /** Monto del anticipo en MXN, si aplica. */
  depositAmountMxn: MoneyMxnSchema.optional(),
  /** id del Procedure (proc_) si la cita es de tipo procedimiento. */
  procedimientoId: z.string().optional(),
}).refine((a) => a.tipo === "bloqueo" || a.patientContactId != null, {
  message: "patientContactId es obligatorio salvo en citas de tipo 'bloqueo'",
  path: ["patientContactId"],
});
export type CreateAppointmentInput = z.infer<typeof CreateAppointmentInputSchema>;

/**
 * Payload para editar metadatos de una cita/bloqueo ya creado. La hora se
 * cambia con `reschedule` (registra historial); esto solo parchea etiquetas y
 * asignación. Todos los campos son opcionales: se aplican los presentes.
 */
export const UpdateAppointmentInputSchema = z.object({
  /** Etiqueta visible (summary de GCal). Para un bloqueo: "Comida", etc. */
  titulo: z.string().optional(),
  /** Motivo/nota. */
  motivo: z.string().optional(),
  /** Reasignar a otra sede (loc_). */
  locationId: z.string().optional(),
  /** Reasignar (o desasignar con "") al doctor (usr_). */
  doctorUserId: z.string().optional(),
  /** Ubicación física libre. */
  ubicacion: z.string().optional(),
  /** Ligar (o corregir) el paciente — p. ej. al completar una cita "por revisar". */
  patientContactId: z.string().optional(),
  /** Marcar/limpiar la bandera de revisión humana (al completar el dato faltante). */
  needsReview: z.boolean().optional(),
  /** Motivo de revisión (se limpia al resolver). */
  reviewReason: z.string().optional(),
});
export type UpdateAppointmentInput = z.infer<typeof UpdateAppointmentInputSchema>;

/** Payload para registrar un pago manualmente. */
export const RegisterPaymentInputSchema = z.object({
  /** id del Contact (cont_) paciente que realiza el pago. */
  patientContactId: z.string(),
  /** id de la Appointment (apt_) a la que aplica, si corresponde. */
  appointmentId: z.string().optional(),
  concepto: PaymentConceptSchema,
  amountMxn: MoneyMxnSchema,
  method: PaymentMethodSchema,
  reference: z.string().optional(),
  /**
   * Estado inicial del pago. `"pendiente"` crea una PROPUESTA (p. ej. la
   * prevalidación IA de un comprobante) que NO registra dinero: no marca el
   * anticipo pagado ni confirma la cita hasta que un humano la confirme con
   * `payments.confirm`. Default: `"confirmado"` (registro directo por humano).
   */
  status: z.enum(["pendiente", "confirmado"]).optional(),
  /** URL del comprobante que respalda el pago (`wa-media:<id>` o https). */
  receiptUrl: z.string().optional(),
});
export type RegisterPaymentInput = z.infer<typeof RegisterPaymentInputSchema>;

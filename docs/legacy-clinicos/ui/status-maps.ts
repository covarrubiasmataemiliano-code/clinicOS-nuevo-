/**
 * Mapas de estado de negocio → etiqueta es-MX + tono visual.
 * TODOS los módulos pintan estados con esto (vía <StatusBadge>) para que
 * "confirmada" se vea IGUAL en inbox, agenda, CRM y finanzas.
 */
import type {
  ActionStatus,
  ActionTier,
  AppointmentStatus,
  AppointmentType,
  AuditCheckStatus,
  AuditFindingSeverity,
  ConsultationStatus,
  DepositStatus,
  EscalationStatus,
  GeneratedDocumentStatus,
  IaState,
  LeadClassificationValue,
  PaymentConcept,
  PaymentStatus,
  NotificationType,
  NotificationUrgency,
} from "@clinicos/contracts";
import { CONCIERGE_NAME } from "./flags";

export type Tone = "success" | "warning" | "destructive" | "primary" | "muted";

export interface StatusMeta {
  label: string;
  tone: Tone;
}

export const IA_STATE: Record<IaState, StatusMeta> = {
  ia_activa: { label: "IA activa", tone: "success" },
  humano: { label: "Humano", tone: "primary" },
  pausada: { label: "Apagado", tone: "warning" },
};

export const LEAD_CLASSIFICATION: Record<LeadClassificationValue, StatusMeta> = {
  pregunton: { label: "Preguntón", tone: "muted" },
  interesado: { label: "Interesado", tone: "primary" },
  anticipo_pendiente: { label: "Anticipo pendiente", tone: "warning" },
  agendado: { label: "Agendado", tone: "success" },
  seguimiento_futuro: { label: "Seguimiento futuro", tone: "muted" },
  spam: { label: "Spam", tone: "destructive" },
};

export const APPOINTMENT_STATUS: Record<AppointmentStatus, StatusMeta> = {
  nueva: { label: "Nueva", tone: "warning" },
  confirmada: { label: "Confirmada", tone: "success" },
  reagendada: { label: "Reagendada", tone: "primary" },
  cancelada: { label: "Cancelada", tone: "destructive" },
  completada: { label: "Completada", tone: "muted" },
  no_show: { label: "No asistió", tone: "destructive" },
};

export const APPOINTMENT_TYPE: Record<AppointmentType, string> = {
  valoracion_presencial: "Valoración presencial",
  valoracion_virtual: "Valoración virtual",
  seguimiento: "Seguimiento",
  procedimiento: "Procedimiento",
  bloqueo: "Horario bloqueado",
};

export const DEPOSIT_STATUS: Record<DepositStatus, StatusMeta> = {
  no_aplica: { label: "Sin anticipo", tone: "muted" },
  pendiente: { label: "Anticipo pendiente", tone: "warning" },
  pagado: { label: "Anticipo pagado", tone: "success" },
  vencido: { label: "Anticipo vencido", tone: "destructive" },
};

export const PAYMENT_STATUS: Record<PaymentStatus, StatusMeta> = {
  pendiente: { label: "Pendiente", tone: "warning" },
  confirmado: { label: "Confirmado", tone: "success" },
  reembolsado: { label: "Reembolsado", tone: "muted" },
  abonado_a_tratamiento: { label: "Abonado a tratamiento", tone: "primary" },
};

export const PAYMENT_CONCEPT: Record<PaymentConcept, string> = {
  anticipo_valoracion: "Anticipo de valoración",
  pago_completo_virtual: "Valoración virtual",
  apartado_cirugia: "Apartado de cirugía",
  liquidacion: "Liquidación",
  abono: "Abono",
  otro: "Otro",
};

export const ESCALATION_STATUS: Record<EscalationStatus, StatusMeta> = {
  pendiente: { label: "Pendiente", tone: "destructive" },
  asignada: { label: "Asignada", tone: "warning" },
  resuelta: { label: "Resuelta", tone: "success" },
};

export const DOCUMENT_STATUS: Record<GeneratedDocumentStatus, StatusMeta> = {
  borrador: { label: "Borrador", tone: "warning" },
  aprobada: { label: "Aprobada", tone: "success" },
  enviada: { label: "Enviada", tone: "primary" },
};

export const CONSULTATION_STATUS: Record<ConsultationStatus, StatusMeta> = {
  grabando: { label: "Grabando", tone: "destructive" },
  pausada: { label: "Pausada", tone: "warning" },
  procesando: { label: "Procesando", tone: "primary" },
  completada: { label: "Completada", tone: "success" },
  cancelada: { label: "Cancelada", tone: "muted" },
};

export const AUDIT_CHECK_STATUS: Record<AuditCheckStatus, StatusMeta> = {
  ok: { label: "OK", tone: "success" },
  warn: { label: "Atención", tone: "warning" },
  fail: { label: "Falla", tone: "destructive" },
};

/** Severidad de un hallazgo de congruencia del auditor. */
export const AUDIT_FINDING_SEVERITY: Record<AuditFindingSeverity, StatusMeta> = {
  info: { label: "Informativo", tone: "muted" },
  warn: { label: "Atención", tone: "warning" },
  urgent: { label: "Urgente", tone: "destructive" },
};

export const ROLE_LABEL: Record<string, string> = {
  superadmin: "Superadmin (agencia)",
  administrador: "Administrador",
  doctor: "Doctor",
  auxiliar: "Auxiliar",
};

export const MODULE_LABEL: Record<string, string> = {
  inbox: "Bandeja de entrada",
  crm: "CRM y expedientes",
  agenda: "Agenda",
  copiloto: "Copiloto de consulta",
  concierge: CONCIERGE_NAME,
  finanzas: "Finanzas",
  configuracion: "Configuración",
  auditor: "Auditor",
  notificaciones: "Notificaciones",
};

/** Estado de una acción del concierge → etiqueta es-MX + tono. */
export const CONCIERGE_ACTION_STATUS: Record<ActionStatus, StatusMeta> = {
  propuesta: { label: "Pendiente de confirmar", tone: "warning" },
  confirmada: { label: "Confirmada", tone: "primary" },
  ejecutada: { label: "Hecho", tone: "success" },
  rechazada: { label: "Descartada", tone: "muted" },
  fallida: { label: "Falló", tone: "destructive" },
};

/** Tier de una acción del concierge → etiqueta es-MX + tono. */
export const CONCIERGE_ACTION_TIER: Record<ActionTier, StatusMeta> = {
  auto: { label: "Automática", tone: "success" },
  confirma: { label: "Requiere confirmación", tone: "warning" },
  bloqueada: { label: "Bloqueada", tone: "destructive" },
};

// Convención de emojis alineada con OpenClaw (Coco/Nugget) para que las alertas se
// "sientan" igual que en el WhatsApp del cel — paridad sin fugas (no-cutover).
// `Record<NotificationType, …>` a propósito: un tipo nuevo sin entrada NO compila.
export const NOTIFICATION_TYPE_META: Record<
  NotificationType,
  { label: string; emoji: string; tone: Tone }
> = {
  nueva_cita: { label: "Nueva cita", emoji: "🆕", tone: "success" },
  reagenda: { label: "Reagenda", emoji: "📅", tone: "primary" },
  cancelacion: { label: "Cancelación", emoji: "❌", tone: "destructive" },
  paciente_escribe: { label: "Paciente escribe", emoji: "🏥", tone: "warning" },
  lead_pide_doctor: { label: "Lead pide al doctor", emoji: "👨🏻‍⚕️", tone: "warning" },
  lead_fuera_alcance: { label: "Fuera de alcance", emoji: "🚨", tone: "destructive" },
  referido: { label: "Referido", emoji: "👀", tone: "primary" },
  prevaloracion_lista: { label: "Prevaloración lista", emoji: "📋", tone: "success" },
  recordatorio: { label: "Recordatorio", emoji: "📌", tone: "primary" },
  escalacion_handoff: { label: "Handoff urgente", emoji: "🆘", tone: "destructive" },
  comprobante_recibido: { label: "Comprobante recibido", emoji: "🧾", tone: "success" },
  pdf_recibido: { label: "Documento recibido", emoji: "📄", tone: "primary" },
};

/** Realce visual por urgencia (la campana/centro resaltan los urgentes). */
export const NOTIFICATION_URGENCY_META: Record<
  NotificationUrgency,
  { label: string; tone: Tone }
> = {
  info: { label: "Informativa", tone: "muted" },
  aviso: { label: "Aviso", tone: "primary" },
  urgente: { label: "Urgente", tone: "destructive" },
};

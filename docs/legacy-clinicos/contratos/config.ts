/**
 * Dominio de configuración de ClinicOS: agentes IA, ajustes de clínica,
 * usuarios, sesiones e integraciones externas (WhatsApp, Google, etc.).
 */

import { z } from "zod";
import {
  IsoDateTimeSchema,
  ActorSchema,
  RoleSchema,
  ModulePermissionsSchema,
  VerticalSchema,
} from "./shared";
import { NotificationSettingsSchema } from "./notificaciones";

// ——— Enums ———

/** Identificador de cada agente IA disponible en la plataforma. */
export const AgentKeySchema = z.enum([
  "recepcionista",
  "concierge",
  "supervisor",
  "copiloto",
  "consultor_ventas",
  "financiero",
  "auditor",
  "pacientes",
]);
export type AgentKey = z.infer<typeof AgentKeySchema>;

/**
 * Secciones que componen el prompt modular de un agente.
 * El orden es significativo y se valida en producción.
 */
export const PromptSectionKeySchema = z.enum([
  "SOUL",
  "AGENTS",
  "CLINIC",
  "SCHEDULE_POLICY",
  "NOTIFICATIONS",
  "SECURITY",
  "TOOLS",
]);
export type PromptSectionKey = z.infer<typeof PromptSectionKeySchema>;

/** Integración de terceros soportada por la plataforma. */
export const IntegrationKeySchema = z.enum([
  "whatsapp",
  "google_calendar",
  "google_drive",
]);
export type IntegrationKey = z.infer<typeof IntegrationKeySchema>;

/** Estado actual de la conexión de una integración. */
export const IntegrationStatusValueSchema = z.enum([
  "conectado",
  "error",
  "desconectado",
]);
export type IntegrationStatusValue = z.infer<typeof IntegrationStatusValueSchema>;

// ——— Entidades ———

/**
 * Sección individual del prompt modular de un agente.
 * Las secciones con editableByClient=false muestran un candado y
 * solo pueden editarse desde la agencia.
 */
export const PromptSectionSchema = z.object({
  /** id de la sección (sec_) */
  id: z.string(),
  /** id del AgentConfig (agt_) al que pertenece esta sección */
  agentId: z.string(),
  key: PromptSectionKeySchema,
  title: z.string(),
  /** Contenido en Markdown */
  content: z.string(),
  /** false = candado "Gestionada por la agencia"; el cliente no puede editar */
  editableByClient: z.boolean(),
  /** Número de versión incremental para control de cambios */
  version: z.number(),
  updatedAt: IsoDateTimeSchema,
  updatedBy: ActorSchema,
});
export type PromptSection = z.infer<typeof PromptSectionSchema>;

/**
 * Seguimiento automático de leads (rescate antes de las 24 h de WhatsApp).
 * Un worker revisa periódicamente y, si un lead escribió hace ~`delayHours`
 * y sigue sin avanzar, le envía el `template` (admite {nombre}).
 */
export const AgentFollowUpSchema = z.object({
  enabled: z.boolean(),
  /** Horas tras el último mensaje del lead para disparar. Debe ser < 24. */
  delayHours: z.number(),
  /** Máximo de seguimientos por lead. */
  maxCount: z.number(),
  /** Plantilla del mensaje de seguimiento; admite el marcador {nombre}. */
  template: z.string(),
});
export type AgentFollowUp = z.infer<typeof AgentFollowUpSchema>;

/**
 * Configuración completa de un agente IA de la clínica.
 * Cada agente tiene un prompt modular; el cliente solo edita las secciones
 * con editableByClient=true. El campo `modelo` es agnóstico de proveedor.
 */
export const AgentConfigSchema = z.object({
  /** id del agente (agt_) */
  id: z.string(),
  /** id de la clínica (cli_) propietaria */
  clinicId: z.string(),
  key: AgentKeySchema,
  /** Nombre visible del agente, ej. "Coco" */
  nombre: z.string(),
  descripcion: z.string(),
  activo: z.boolean(),
  /** Identificador del modelo LLM, ej. "claude-sonnet" — agnóstico de proveedor */
  modelo: z.string(),
  /** Emoji que identifica visualmente al agente en la UI */
  avatarEmoji: z.string().optional(),
  promptSections: z.array(PromptSectionSchema),
  /**
   * Skills/tools habilitadas para este agente (ids de tool, p.ej. "crear_cita").
   * Ausente o vacío = se habilitan todas las tools del runtime. Permite
   * prender/apagar capacidades por clínica desde la config, sin tocar código.
   */
  enabledTools: z.array(z.string()).optional(),
  /**
   * true = el agente toma automáticamente las conversaciones de leads NUEVOS
   * (las atiende en cuanto escriben). false/ausente = la conversación nueva
   * nace en "humano" (coexistencia: una persona la atiende primero).
   */
  autoEngageNewLeads: z.boolean().optional(),
  /** Configuración del seguimiento automático de leads (rescate < 24 h). */
  followUp: AgentFollowUpSchema.optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/**
 * Cuenta bancaria registrada en la clínica para recibir pagos.
 */
export const BankAccountSchema = z.object({
  /** id de la cuenta bancaria (generado internamente) */
  id: z.string(),
  banco: z.string(),
  /** CLABE parcialmente ocultada para mostrar en UI, ej. "•••• 2501" */
  clabeMasked: z.string(),
  /** CLABE completa — la que el agente comparte con el paciente para transferir. */
  clabe: z.string().optional(),
  /** Nº de tarjeta para transferencias a tarjeta (opcional). */
  tarjeta: z.string().optional(),
  titular: z.string(),
});
export type BankAccount = z.infer<typeof BankAccountSchema>;

/**
 * Enlace de pago configurado por la clínica (Clip, Conekta, etc.).
 */
export const PaymentLinkItemSchema = z.object({
  /** id del enlace de pago */
  id: z.string(),
  /** Etiqueta visible, ej. "Pago con tarjeta" */
  label: z.string(),
  url: z.string(),
});
export type PaymentLinkItem = z.infer<typeof PaymentLinkItemSchema>;

/**
 * Personalización visual de la clínica dentro de la plataforma.
 */
export const ClinicBrandingSchema = z.object({
  /** URL pública del logotipo */
  logoUrl: z.string().optional(),
  /** Color CSS que sobreescribe la variable --primary de la UI, ej. "#E91E8C" */
  accentColor: z.string().optional(),
  /** Nombre corto mostrado en cabeceras y notificaciones */
  nombreCorto: z.string().optional(),
});
export type ClinicBranding = z.infer<typeof ClinicBrandingSchema>;

/**
 * Ajustes generales de una clínica: identidad, zona horaria,
 * cuentas bancarias, enlaces de pago y modo demo.
 */
export const ClinicSettingsSchema = z.object({
  /** id de la clínica (cli_) dueña de esta configuración */
  clinicId: z.string(),
  nombreComercial: z.string(),
  vertical: VerticalSchema,
  branding: ClinicBrandingSchema,
  /** Zona horaria IANA, ej. "America/Mexico_City" */
  timezone: z.string(),
  /** Siempre "MXN" para clínicas en México */
  moneda: z.literal("MXN"),
  bankAccounts: z.array(BankAccountSchema),
  paymentLinks: z.array(PaymentLinkItemSchema),
  /** Modo demo: inserta mensajes entrantes simulados para pruebas y onboarding */
  demoMode: z.boolean(),
  /**
   * Día en que inicia la semana en la agenda: 0 = domingo (default), 1 = lunes.
   * Preferencia por-clínica; ausente = domingo.
   */
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
  /**
   * Configuración de notificaciones de la clínica (destinatarios por tipo, routing
   * por-persona, horario silencioso). Opcional: ausencia = política default.
   */
  notifications: NotificationSettingsSchema.optional(),
});
export type ClinicSettings = z.infer<typeof ClinicSettingsSchema>;

/**
 * Usuario de la plataforma con permisos efectivos ya resueltos
 * (defaults del rol + overrides aplicados por el administrador).
 */
export const UserSchema = z.object({
  /** id del usuario (usr_) */
  id: z.string(),
  /** id de la clínica (cli_) a la que pertenece */
  clinicId: z.string(),
  nombre: z.string(),
  email: z.string(),
  telefono: z.string().optional(),
  rol: RoleSchema,
  /** URL pública del avatar del usuario */
  avatarUrl: z.string().optional(),
  /**
   * Permisos EFECTIVOS del usuario: defaults del rol más los overrides
   * que haya configurado el administrador de la clínica.
   */
  modulePermissions: ModulePermissionsSchema,
  activo: z.boolean(),
  createdAt: IsoDateTimeSchema,
});
export type User = z.infer<typeof UserSchema>;

/**
 * Sesión activa de un usuario autenticado.
 * Contiene la identidad del usuario y los datos de la clínica activa.
 */
export const SessionSchema = z.object({
  user: UserSchema,
  /** id de la clínica activa en esta sesión (cli_) */
  clinicId: z.string(),
  clinicNombre: z.string(),
  vertical: VerticalSchema,
});
export type Session = z.infer<typeof SessionSchema>;

/**
 * Estado actual de una integración de terceros conectada a la clínica.
 */
export const IntegrationStatusSchema = z.object({
  key: IntegrationKeySchema,
  status: IntegrationStatusValueSchema,
  /** Cuenta o identificador visible conectado, ej. "drestebanmoreno@gmail.com" */
  accountLabel: z.string(),
  /** Timestamp de la última sincronización exitosa */
  lastSyncAt: IsoDateTimeSchema.optional(),
  /** Mensaje de error cuando status="error" */
  errorDetail: z.string().optional(),
});
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

// ——— Inputs ———

/**
 * Payload para actualizar el contenido de una sección de prompt.
 */
export const UpdatePromptSectionInputSchema = z.object({
  content: z.string(),
});
export type UpdatePromptSectionInput = z.infer<typeof UpdatePromptSectionInputSchema>;

/**
 * Datos necesarios para invitar a un nuevo usuario a la clínica.
 */
export const CreateUserInputSchema = z.object({
  nombre: z.string(),
  email: z.string(),
  telefono: z.string().optional(),
  rol: RoleSchema,
});
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

/**
 * Campos actualizables de un usuario existente.
 * Todos opcionales; solo se aplican los que se envíen.
 */
export const UpdateUserInputSchema = z.object({
  nombre: z.string().optional(),
  email: z.string().optional(),
  telefono: z.string().optional(),
  rol: RoleSchema.optional(),
  activo: z.boolean().optional(),
  modulePermissions: ModulePermissionsSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;

/**
 * Campos de configuración de clínica que el administrador puede modificar.
 */
export const UpdateClinicSettingsInputSchema = z.object({
  nombreComercial: z.string().optional(),
  branding: ClinicBrandingSchema.optional(),
  timezone: z.string().optional(),
  demoMode: z.boolean().optional(),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
  notifications: NotificationSettingsSchema.optional(),
});
export type UpdateClinicSettingsInput = z.infer<typeof UpdateClinicSettingsInputSchema>;

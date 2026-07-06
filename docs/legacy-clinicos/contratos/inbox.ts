import { z } from "zod";
import {
  IsoDateTimeSchema,
  MoneyMxnSchema,
  PhoneE164Schema,
  ActorSchema,
  ExternalSourceSchema,
} from "./shared";
import { NotificationUrgencySchema } from "./notificaciones";

/**
 * Dominio de Inbox de ClinicOS: contactos, conversaciones de WhatsApp,
 * mensajes, sugerencias de IA, escalaciones y configuración de números.
 */

// ——— Enums de contacto ———

/** Tipo de contacto en el CRM de la clínica. */
export const ContactTypeSchema = z.enum([
  "lead",
  "paciente",
  "equipo",
  "proveedor",
]);
export type ContactType = z.infer<typeof ContactTypeSchema>;

/** Canal por el que el contacto llegó a la clínica. */
export const ContactSourceSchema = z.enum([
  "anuncio",
  "organico",
  "referido",
  "campania",
  "manual",
]);
export type ContactSource = z.infer<typeof ContactSourceSchema>;

// ——— Enums de calificación de lead ———

/** Clasificación cualitativa de un lead según su intención de compra. */
export const LeadClassificationValueSchema = z.enum([
  "pregunton",
  "interesado",
  "anticipo_pendiente",
  "agendado",
  "seguimiento_futuro",
  "spam",
]);
export type LeadClassificationValue = z.infer<
  typeof LeadClassificationValueSchema
>;

// ——— Enums de conversación ———

/**
 * Máquina de estados del agente de IA en la conversación.
 * ia_activa: la IA responde sola; humano: un agente tomó el control;
 * pausada: la IA espera hasta pausedUntil.
 */
export const IaStateSchema = z.enum(["ia_activa", "humano", "pausada"]);
export type IaState = z.infer<typeof IaStateSchema>;

// ——— Enums de mensaje ———

/** Sentido del mensaje: entrante del contacto o saliente de la clínica. */
export const MessageDirectionSchema = z.enum(["in", "out"]);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

/** Quién es el autor lógico del mensaje. */
export const MessageAuthorTypeSchema = z.enum(["contacto", "ia", "humano"]);
export type MessageAuthorType = z.infer<typeof MessageAuthorTypeSchema>;

/** Formato o tipo de contenido del mensaje de WhatsApp. */
export const MessageTypeSchema = z.enum([
  "text",
  "audio",
  "image",
  "video",
  "document",
  "template",
]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

/** Estado de entrega del mensaje saliente en Meta. */
export const MessageStatusSchema = z.enum([
  "enviando",
  "enviado",
  "entregado",
  "leido",
  "fallido",
]);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

// ——— Enums de sugerencias IA ———

/** Modo de generación de sugerencias: normal o modo consultor de ventas. */
export const SuggestionModeSchema = z.enum(["normal", "consultor_ventas"]);
export type SuggestionMode = z.infer<typeof SuggestionModeSchema>;

/** Estado del ciclo de vida de la sugerencia generada. */
export const SuggestionStatusSchema = z.enum([
  "pendiente",
  "usada",
  "editada",
  "descartada",
]);
export type SuggestionStatus = z.infer<typeof SuggestionStatusSchema>;

// ——— Enums de escalación ———

/** Motivo de la escalación de la conversación a un humano. */
export const EscalationTypeSchema = z.enum([
  "lead_pide_doctor",
  "lead_fuera_alcance",
  "paciente_escribe",
  // Handoff URGENTE: caso sensible (quirúrgico/post-op, pago, queja) que necesita
  // a una persona cuanto antes. Genera notificación urgente (no se silencia).
  "escalacion_handoff",
  "otro",
]);
export type EscalationType = z.infer<typeof EscalationTypeSchema>;

/** Estado de resolución de la escalación. */
export const EscalationStatusSchema = z.enum([
  "pendiente",
  "asignada",
  "resuelta",
]);
export type EscalationStatus = z.infer<typeof EscalationStatusSchema>;

// ——— Enums de número WhatsApp ———

/** Estado de conexión del número de WhatsApp Business con Meta. */
export const WhatsAppNumberStatusSchema = z.enum([
  "conectado",
  "desconectado",
  "pendiente",
]);
export type WhatsAppNumberStatus = z.infer<typeof WhatsAppNumberStatusSchema>;

/** Calidad de la cuenta de WhatsApp Business según métricas de Meta. */
export const WhatsAppQualitySchema = z.enum(["green", "yellow", "red"]);
export type WhatsAppQuality = z.infer<typeof WhatsAppQualitySchema>;

// ——— Entidades ———

/**
 * Clasificación manual o automática de un lead.
 * Se embebe dentro de Contact cuando tipo === "lead".
 */
export const LeadClassificationSchema = z.object({
  value: LeadClassificationValueSchema,
  /** Actor (IA o usuario) que realizó la clasificación. */
  classifiedBy: ActorSchema,
  /** Justificación opcional del clasificador. */
  motivo: z.string().optional(),
  classifiedAt: IsoDateTimeSchema,
});
export type LeadClassification = z.infer<typeof LeadClassificationSchema>;

/**
 * Persona o entidad con la que la clínica tiene comunicación.
 * Puede ser lead, paciente, miembro del equipo o proveedor.
 */
export const ContactSchema = z.object({
  id: z.string(),
  /** id de la clínica (cli_) a la que pertenece el contacto. */
  clinicId: z.string(),
  tipo: ContactTypeSchema,
  nombre: z.string(),
  whatsappPhone: PhoneE164Schema,
  /** Correo electrónico del contacto (opcional; usado como invitado en citas de Google Calendar). */
  email: z.string().optional(),
  /** URL de la foto de perfil o avatar del contacto. */
  avatarUrl: z.string().optional(),
  fuente: ContactSourceSchema,
  /**
   * Id de este contacto en el sistema externo de origen (p. ej. page id de
   * Notion, ManyChat ID). Junto con `source` forma la llave de idempotencia de
   * migración/sync. Distinto de `fuente` (canal de adquisición).
   */
  externalId: z.string().optional(),
  /** Sistema externo del que se importó o con el que se sincroniza el contacto. */
  source: ExternalSourceSchema.optional(),
  /** Etiquetas libres para categorización. */
  etiquetas: z.array(z.string()),
  /** Clasificación del lead; presente solo cuando tipo === "lead". */
  leadClassification: LeadClassificationSchema.optional(),
  /** id de la etapa del pipeline (stg_) en la que se encuentra. */
  pipelineStageId: z.string().optional(),
  /** id del expediente clínico (rec_) del paciente. */
  patientRecordId: z.string().optional(),
  /** id del procedimiento de interés (proc_) detectado. */
  procedimientoInteresId: z.string().optional(),
  /** Valor monetario estimado de la oportunidad en pesos mexicanos. */
  valorEstimadoMxn: MoneyMxnSchema.optional(),
  /** Ciudad o municipio del contacto. */
  ciudad: z.string().optional(),
  /** Fecha-hora en que el contacto hizo su primera interacción. */
  contactoInicialAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  /**
   * Soft-delete: si está presente, el contacto está ARCHIVADO (oculto de las
   * listas por defecto, recuperable). El borrado físico es aparte y gated por
   * `ENABLE_CONTACT_DELETION`. Datos médicos: preferimos archivar a destruir.
   */
  archivedAt: IsoDateTimeSchema.optional(),
});
export type Contact = z.infer<typeof ContactSchema>;

/**
 * Hilo de conversación de WhatsApp entre la clínica y un contacto.
 * Contiene el estado de la IA y metadatos de la última actividad.
 */
export const ConversationSchema = z.object({
  id: z.string(),
  /** id de la clínica (cli_) dueña de la conversación. */
  clinicId: z.string(),
  /** id del Contact (cont_) dueño de la conversación. */
  contactId: z.string(),
  /** id del número de WhatsApp de Meta (phoneNumberId de la WABA). */
  phoneNumberId: z.string(),
  /**
   * Id de esta conversación/hilo en el sistema externo de origen. Junto con
   * `source` forma la llave de idempotencia de migración/sync (evita duplicar
   * hilos en re-runs).
   */
  externalId: z.string().optional(),
  /** Sistema externo del que se importó o con el que se sincroniza la conversación. */
  source: ExternalSourceSchema.optional(),
  iaState: IaStateSchema,
  /** Actor que realizó el último cambio de estado de la IA. */
  iaStateChangedBy: ActorSchema,
  iaStateChangedAt: IsoDateTimeSchema,
  /** Fecha-hora hasta la que la IA permanece pausada (solo si iaState === "pausada"). */
  pausedUntil: IsoDateTimeSchema.optional(),
  /** Indica si está activo el modo consultor de ventas para esta conversación. */
  salesConsultantMode: z.boolean(),
  /** id del usuario (usr_) asignado como responsable de la conversación. */
  assignedToUserId: z.string().optional(),
  /** Cantidad de mensajes no leídos por la clínica. */
  unreadCount: z.number(),
  /** Fecha-hora del último mensaje recibido o enviado. */
  lastMessageAt: IsoDateTimeSchema,
  /** Texto corto del último mensaje para mostrar en la lista. */
  lastMessagePreview: z.string(),
  /** Indica si el contacto está en la lista negra y no debe recibir mensajes. */
  isBlacklisted: z.boolean(),
  /** Nº de mensajes de seguimiento automático ya enviados al lead (rescate < 24 h). */
  followUpCount: z.number().optional(),
  /** Fecha-hora del último seguimiento automático enviado. */
  lastFollowUpAt: IsoDateTimeSchema.optional(),
  createdAt: IsoDateTimeSchema,
});
export type Conversation = z.infer<typeof ConversationSchema>;

/**
 * Adjunto multimedia de un mensaje de WhatsApp.
 * Cubre audio, imagen, video, documento y más.
 */
export const MessageMediaSchema = z.object({
  /** URL pública o firmada para acceder al archivo. */
  url: z.string(),
  /** Tipo MIME del archivo, ej. "audio/ogg", "image/jpeg". */
  mimeType: z.string(),
  /** Nombre original del archivo, presente en documentos. */
  fileName: z.string().optional(),
  /** Tamaño del archivo en kilobytes. */
  sizeKb: z.number().optional(),
  /** Duración en segundos para archivos de audio o video. */
  durationSec: z.number().optional(),
  /** Transcripción del audio de la nota de voz. */
  transcript: z.string().optional(),
  /** Leyenda o descripción adjunta a la imagen o video. */
  caption: z.string().optional(),
  /** Número de páginas para archivos PDF. */
  pageCount: z.number().optional(),
  /** URL de la miniatura de previsualización. */
  thumbnailUrl: z.string().optional(),
});
export type MessageMedia = z.infer<typeof MessageMediaSchema>;

/**
 * Mensaje individual dentro de una conversación de WhatsApp.
 * Puede ser entrante del contacto o saliente de la clínica (IA o humano).
 */
export const MessageSchema = z.object({
  id: z.string(),
  /** id de la conversación (conv_) a la que pertenece este mensaje. */
  conversationId: z.string(),
  direction: MessageDirectionSchema,
  authorType: MessageAuthorTypeSchema,
  /** id del usuario (usr_) autor; presente solo cuando authorType === "humano". */
  authorUserId: z.string().optional(),
  type: MessageTypeSchema,
  /** Contenido de texto del mensaje; obligatorio si type === "text". */
  body: z.string().optional(),
  /** Adjunto multimedia; presente para tipos audio, image, video, document. */
  media: MessageMediaSchema.optional(),
  status: MessageStatusSchema,
  sentAt: IsoDateTimeSchema,
  /** id del mensaje en WhatsApp (wamid…), para emparejar updates de estado. */
  waMessageId: z.string().optional(),
  /** Reacciones (emojis) sobre este mensaje. `fromContact` = la puso el contacto. */
  reactions: z
    .array(z.object({ emoji: z.string(), fromContact: z.boolean() }))
    .optional(),
  /** Si el mensaje fue editado (corregido), cuándo fue la última edición (ISO). */
  editedAt: IsoDateTimeSchema.optional(),
  /** Si el mensaje fue eliminado/revocado por quien lo envió, cuándo (ISO). */
  deletedAt: IsoDateTimeSchema.optional(),
  /**
   * Calificación humana de una respuesta de la IA (entrenamiento): 👍/👎 y,
   * si no gustó, cómo se hubiera querido responder.
   */
  feedback: z
    .object({
      liked: z.boolean(),
      betterResponse: z.string().optional(),
      byUserId: z.string(),
      at: IsoDateTimeSchema,
    })
    .optional(),
});
export type Message = z.infer<typeof MessageSchema>;

/** Input para calificar una respuesta de la IA (botones 👍/👎 del inbox). */
export const MessageFeedbackInputSchema = z.object({
  liked: z.boolean(),
  /** Cómo se hubiera querido responder (solo cuando liked=false). */
  betterResponse: z.string().optional(),
});
export type MessageFeedbackInput = z.infer<typeof MessageFeedbackInputSchema>;

/**
 * Borrador individual dentro de una sugerencia de IA.
 * Cada sugerencia incluye exactamente 3 drafts con diferente tono o enfoque.
 */
export const AISuggestionDraftSchema = z.object({
  id: z.string(),
  /** Texto del borrador listo para enviar o editar. */
  text: z.string(),
});
export type AISuggestionDraft = z.infer<typeof AISuggestionDraftSchema>;

/**
 * Sugerencia generada por la IA para que el agente humano responda.
 * Contiene 3 borradores alternativos con diferente tono.
 */
export const AISuggestionSchema = z.object({
  id: z.string(),
  /** id de la conversación (conv_) para la que se generó la sugerencia. */
  conversationId: z.string(),
  mode: SuggestionModeSchema,
  /** Los 3 borradores alternativos generados por la IA. */
  drafts: z.array(AISuggestionDraftSchema),
  generatedAt: IsoDateTimeSchema,
  status: SuggestionStatusSchema,
  /** id del borrador (dentro de drafts) que el agente seleccionó o usó. */
  usedDraftId: z.string().optional(),
});
export type AISuggestion = z.infer<typeof AISuggestionSchema>;

/**
 * Dataset de aprendizaje — se captura TODO lo que un humano envía,
 * con IA encendida o apagada. Permite mejorar la calidad de las sugerencias.
 */
export const SuggestionFeedbackSchema = z.object({
  id: z.string(),
  /** id de la clínica (cli_) donde ocurrió el envío. */
  clinicId: z.string(),
  /** id de la conversación (conv_) en la que se envió el mensaje. */
  conversationId: z.string(),
  /** id de la sugerencia (sug_) de origen, si el mensaje vino de una sugerencia. */
  suggestionId: z.string().optional(),
  /** Texto del borrador seleccionado antes de que el agente lo editara. */
  originalDraftText: z.string().optional(),
  /** Texto final exacto que se envió al contacto. */
  finalTextSent: z.string(),
  /** Estado de la IA en el momento del envío. */
  iaStateAtSend: IaStateSchema,
  /** id del usuario (usr_) que envió el mensaje. */
  sentByUserId: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type SuggestionFeedback = z.infer<typeof SuggestionFeedbackSchema>;

/**
 * Evento que registra la escalación de una conversación a atención humana.
 * Permite rastrear el ciclo pendiente → asignada → resuelta.
 */
export const EscalationEventSchema = z.object({
  id: z.string(),
  /** id de la clínica (cli_) donde ocurrió la escalación. */
  clinicId: z.string(),
  /** id de la conversación (conv_) que fue escalada. */
  conversationId: z.string(),
  tipo: EscalationTypeSchema,
  estado: EscalationStatusSchema,
  /** Urgencia de la escalación (urgente = handoff que no espera). Ausente = "aviso". */
  urgencia: NotificationUrgencySchema.optional(),
  /** Descripción del motivo de la escalación. */
  motivo: z.string(),
  /** id del usuario (usr_) al que fue asignada la escalación. */
  assignedToUserId: z.string().optional(),
  createdAt: IsoDateTimeSchema,
  /** Fecha-hora en que la escalación fue marcada como resuelta. */
  resolvedAt: IsoDateTimeSchema.optional(),
});
export type EscalationEvent = z.infer<typeof EscalationEventSchema>;

/**
 * Input para crear una escalación en vivo (la emite el agente de IA al pasar
 * la conversación a atención humana). El provider rellena id, clinicId, estado
 * inicial ("pendiente") y createdAt.
 */
export const EscalationCreateInputSchema = z.object({
  /** id de la conversación (conv_) que se escala. */
  conversationId: z.string(),
  /** id del Contact (cont_) dueño de la conversación. */
  contactId: z.string(),
  /** Motivo categórico de la escalación. */
  tipo: EscalationTypeSchema,
  /** Urgencia (si se omite, el provider la deriva del tipo: handoff = urgente). */
  urgencia: NotificationUrgencySchema.optional(),
  /** Descripción libre del motivo de la escalación. */
  motivo: z.string(),
});
export type EscalationCreateInput = z.infer<typeof EscalationCreateInputSchema>;

/**
 * Número de teléfono bloqueado para no recibir mensajes ni contacto de la clínica.
 */
export const BlacklistEntrySchema = z.object({
  id: z.string(),
  /** id de la clínica (cli_) que registró el bloqueo. */
  clinicId: z.string(),
  /** Número telefónico en formato de 10 dígitos normalizados sin lada de país. */
  phone: z.string(),
  /** id del Contact (cont_) asociado al número bloqueado, si existe. */
  contactId: z.string().optional(),
  /** Razón por la que se agregó a la lista negra. */
  motivo: z.string(),
  /** id del usuario (usr_) que creó el registro. */
  createdByUserId: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type BlacklistEntry = z.infer<typeof BlacklistEntrySchema>;

/**
 * Número de WhatsApp Business registrado en la WABA de la clínica.
 * Cada número puede tener un agente de IA asignado.
 */
export const WhatsAppNumberSchema = z.object({
  id: z.string(),
  /** id de la clínica (cli_) propietaria del número. */
  clinicId: z.string(),
  /** Identificador del número de teléfono en la API de Meta. */
  phoneNumberId: z.string(),
  /** Identificador de la WhatsApp Business Account en Meta. */
  wabaId: z.string(),
  /** Número formateado para mostrar al usuario, ej. "+52 33 1234 5678". */
  displayPhone: z.string(),
  /** Nombre descriptivo del número, ej. "Consultorio GDL". */
  label: z.string(),
  status: WhatsAppNumberStatusSchema,
  quality: WhatsAppQualitySchema,
  /** id del agente de IA (agt_) configurado para este número. */
  assignedAgentId: z.string().optional(),
});
export type WhatsAppNumber = z.infer<typeof WhatsAppNumberSchema>;

// ——— Filtros y Drafts ———

/**
 * Pestañas del inbox: leads, pacientes y equipo.
 * La pestaña "equipo" agrupa contactos tipo equipo Y proveedor.
 */
export const InboxTabSchema = z.enum(["leads", "pacientes", "equipo"]);
export type InboxTab = z.infer<typeof InboxTabSchema>;

/**
 * Parámetros de filtrado para la lista de conversaciones del inbox.
 */
export const ConversationFiltersSchema = z.object({
  /** Pestaña activa del inbox. */
  tab: InboxTabSchema.optional(),
  /** Filtrar por clasificación de lead. */
  clasificacion: LeadClassificationValueSchema.optional(),
  /** Filtrar por estado de la IA en la conversación. */
  iaState: IaStateSchema.optional(),
  /** Mostrar solo conversaciones con escalaciones pendientes. */
  soloEscaladas: z.boolean().optional(),
  /** Cola "Sin contestar": solo conversaciones con no leídos, más viejas primero. */
  soloSinContestar: z.boolean().optional(),
  /** id del usuario (usr_) al que están asignadas las conversaciones. */
  asignadaA: z.string().optional(),
  /** Texto libre para buscar por nombre o número de contacto. */
  busqueda: z.string().optional(),
});
export type ConversationFilters = z.infer<typeof ConversationFiltersSchema>;

/**
 * Payload que el composer del frontend envía al provider para enviar un mensaje.
 * Soporta texto, audio, imagen y documento.
 */
export const SendMessageDraftSchema = z.object({
  type: z.enum(["text", "audio", "image", "document", "video"]),
  /** Texto del mensaje; requerido cuando type === "text". */
  body: z.string().optional(),
  /** Adjunto multimedia; requerido para tipos audio, image y document. */
  media: MessageMediaSchema.optional(),
  /** id de la sugerencia (sug_) de la que proviene el mensaje, si aplica. */
  fromSuggestionId: z.string().optional(),
  /** Texto original del borrador antes de que el agente lo editara. */
  originalDraftText: z.string().optional(),
});
export type SendMessageDraft = z.infer<typeof SendMessageDraftSchema>;

/**
 * Payload para crear un contacto nuevo de forma inline (p.ej. desde el diálogo
 * de "Nueva cita" en la Agenda cuando el paciente todavía no existe en el CRM).
 * El contacto se crea como lead orgánico; el resto de campos se rellenan con
 * valores por defecto en el provider.
 */
export const CreateContactInputSchema = z.object({
  nombre: z.string(),
  /** Teléfono/WhatsApp; se normaliza a E.164 ("+" + dígitos). */
  whatsappPhone: z.string(),
  /** Correo electrónico opcional del contacto. */
  email: z.string().optional(),
  /**
   * Canal real por el que se da de alta el lead — atribución del evento
   * `lead_creado`. A `contacts.create` lo invocan dos superficies distintas:
   * la UI del CRM ("panel", default si se omite) y la herramienta
   * `crear_contacto` del Concierge ("concierge"); el input debe decirlo
   * porque el provider no puede distinguir a su llamador.
   */
  canal: z.enum(["panel", "concierge"]).optional(),
});
export type CreateContactInput = z.infer<typeof CreateContactInputSchema>;

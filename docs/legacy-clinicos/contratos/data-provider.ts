/**
 * DataProvider — la interfaz ÚNICA por la que el frontend obtiene y muta datos.
 *
 * Hoy: MockProvider (@clinicos/mocks) — estado en memoria + localStorage.
 * Mañana: ApiProvider → apps/engine (HTTP + SSE), MISMA interfaz.
 * Swap por NEXT_PUBLIC_DATA_PROVIDER=mock|api. Ninguna pantalla cambia.
 *
 * Convenciones:
 * - Todo está implícitamente scoped a la clínica de la sesión activa.
 * - Las mutaciones devuelven la entidad actualizada (para invalidación optimista).
 * - subscribe() entrega eventos en tiempo real (mock: timers; api: SSE).
 */
import type {
  IsoDate,
  IsoDateTime,
  MoneyMxn,
  Unsubscribe,
  Vertical,
} from "./shared";
import type {
  AISuggestion,
  BlacklistEntry,
  Contact,
  Conversation,
  ConversationFilters,
  CreateContactInput,
  EscalationEvent,
  EscalationCreateInput,
  IaState,
  LeadClassificationValue,
  Message,
  MessageFeedbackInput,
  SendMessageDraft,
  SuggestionMode,
  WhatsAppNumber,
} from "./inbox";
import type {
  ContactFilters,
  CustomFieldDef,
  PatientFile,
  PatientFileCategory,
  PatientReconcileResult,
  PatientRecord,
  PipelineStage,
  PreAssessment,
  TimelineItem,
  UpdatePatientRecordInput,
} from "./crm";
import type {
  AgendaFilters,
  Appointment,
  AvailabilitySlot,
  CatalogIntakeDraft,
  CreateAppointmentInput,
  UpdateAppointmentInput,
  DepositSettings,
  DoctorSchedule,
  Location,
  OpeningHours,
  Payment,
  Procedure,
  RegisterPaymentInput,
  SchedulePolicyWindow,
  WeekDayHours,
} from "./agenda";
import type {
  ClinicalNote,
  ConsultationSession,
  DailyDigest,
  CreateDocumentInput,
  GeneratedDocument,
  PrescriptionContent,
  QuoteContent,
  StartWalkInInput,
} from "./copiloto";
import type {
  AdvisorChatMessage,
  CreateExpenseInput,
  Expense,
  FinanceDashboard,
  FinancialReport,
  OcrExtract,
} from "./finanzas";
import type {
  ConciergeAction,
  ConciergeAttachment,
  ConciergeCapability,
  ConciergeMessage,
  ConciergeTurnResult,
} from "./concierge";
import type { DriveFile, DriveStatus, DriveUploadInput } from "./drive";
import type {
  AgentConfig,
  ClinicSettings,
  CreateUserInput,
  IntegrationStatus,
  PromptSection,
  Session,
  UpdateClinicSettingsInput,
  UpdatePromptSectionInput,
  UpdateUserInput,
  User,
} from "./config";
import type {
  NotificationEvent,
  CreateNotificationInput,
} from "./notificaciones";
import type { AuditFinding, AuditReport, AuditRunResult } from "./auditor";
import type {
  WhatsAppConfig,
  UpdateWhatsAppConfigInput,
  WebhookLog,
} from "./whatsapp";
import type { GoogleCalendarConnection } from "./google";
import type {
  ImportAppointment,
  ImportBatch,
  ImportContact,
  ImportPatientRecord,
  ImportPayment,
  ImportPlan,
  UpsertResult,
} from "./admin";
import type { DomainEvent, EmitEventInput, EventFilters } from "./events";
import type { EntityProfile, ProfileEntityType } from "./profiles";
import type {
  Asset,
  AssetFilters,
  AssetIngestResult,
  AssetIngestStatus,
  CreateAssetInput,
} from "./assets";
import type { PatientProcedure } from "./journey";

/** Clínica disponible en el login de demo. */
export interface ClinicSummary {
  clinicId: string;
  nombre: string;
  vertical: Vertical;
}

/** Contexto completo de un contacto: lo que un agente IA "sabe" de él. */
export interface ContactContext {
  contact: Contact;
  record?: PatientRecord;
  conversations: Conversation[];
  timeline: TimelineItem[];
  appointments: Appointment[];
  payments: Payment[];
}

export interface DataProvider {
  auth: {
    getSession(): Promise<Session | null>;
    listClinics(): Promise<ClinicSummary[]>;
    listDemoUsers(clinicId: string): Promise<User[]>;
    loginAs(clinicId: string, userId: string): Promise<Session>;
    /**
     * Login real con correo y contraseña (producción, provider=api).
     * En el MockProvider de demo no está implementado — la demo usa loginAs.
     */
    login?(email: string, password: string): Promise<Session>;
    /** Cambia la contraseña del usuario en sesión (producción). */
    changePassword?(currentPassword: string, newPassword: string): Promise<void>;
    logout(): Promise<void>;
  };

  conversations: {
    list(filters?: ConversationFilters): Promise<Conversation[]>;
    get(id: string): Promise<Conversation>;
    /** Toda transición lleva actor y timestamp — sin reactivaciones ciegas. */
    setIaState(
      id: string,
      state: IaState,
      opts?: { pausedUntil?: IsoDateTime }
    ): Promise<Conversation>;
    setSalesConsultantMode(id: string, on: boolean): Promise<Conversation>;
    assign(id: string, userId?: string): Promise<Conversation>;
    markRead(id: string): Promise<void>;
  };

  messages: {
    list(conversationId: string): Promise<Message[]>;
    send(conversationId: string, draft: SendMessageDraft): Promise<Message>;
    /** Califica una respuesta de la IA (👍/👎 + cómo se hubiera querido responder). */
    feedback(messageId: string, input: MessageFeedbackInput): Promise<Message>;
    /** Mensajes entrantes en vivo (modo demo / SSE futuro). */
    subscribe(cb: (msg: Message) => void): Unsubscribe;
  };

  suggestions: {
    getFor(conversationId: string, mode: SuggestionMode): Promise<AISuggestion>;
    regenerate(
      conversationId: string,
      mode: SuggestionMode
    ): Promise<AISuggestion>;
    /** Total de ejemplos de aprendizaje capturados (SuggestionFeedback). */
    feedbackCount(): Promise<number>;
  };

  escalations: {
    /**
     * Crea una escalación en vivo (la emite el agente al pasar a humano).
     * IDEMPOTENTE: si ya existe una escalación NO resuelta para la conversación,
     * la devuelve en vez de duplicar.
     */
    create(input: EscalationCreateInput): Promise<EscalationEvent>;
    list(soloPendientes?: boolean): Promise<EscalationEvent[]>;
    getForConversation(conversationId: string): Promise<EscalationEvent | null>;
    assign(id: string, userId: string): Promise<EscalationEvent>;
    resolve(id: string): Promise<EscalationEvent>;
  };

  contacts: {
    list(filters?: ContactFilters): Promise<Contact[]>;
    get(id: string): Promise<Contact>;
    /** Crea un contacto nuevo (lead orgánico) — p.ej. inline desde "Nueva cita". */
    create(input: CreateContactInput): Promise<Contact>;
    classify(
      id: string,
      value: LeadClassificationValue,
      motivo?: string
    ): Promise<Contact>;
    setPipelineStage(id: string, stageId: string): Promise<Contact>;
    update(
      id: string,
      partial: Partial<
        Pick<
          Contact,
          | "nombre"
          | "ciudad"
          | "etiquetas"
          | "procedimientoInteresId"
          | "valorEstimadoMxn"
          | "whatsappPhone"
          | "email"
        >
      >
    ): Promise<Contact>;
    /** Ficha + historial completo: el contexto que ven los agentes. */
    getContext(id: string): Promise<ContactContext>;
    /** Lead → paciente (crea PatientRecord y conserva el mismo Contact). */
    convertToPatient(id: string): Promise<Contact>;
    /**
     * Reconcilia el ciclo de vida de un paciente ya incongruente (event sourcing):
     * re-emite los eventos faltantes (`lead_convertido_paciente`, `cita_creada`,
     * `consulta_iniciada/finalizada`, `cita_completada`) y corrige el estado
     * derivado (etapa de pipeline nula, cita de una consulta hecha que quedó sin
     * marcar "completada"). Idempotente: corre las veces que sea sin duplicar. Es
     * el "resolver vía el sistema" que cura entidades rotas por flujos viejos (p.
     * ej. walk-ins creados antes del fix de `startWalkIn`) en vez de backfill manual.
     */
    reconcilePatient(id: string): Promise<PatientReconcileResult>;
    /**
     * Revierte paciente → lead (deshace una conversión hecha por error): vuelve
     * `tipo` a "lead", lo mueve a la primera etapa de leads y DESVINCULA el
     * expediente (el PatientRecord queda huérfano, recuperable; no se borra).
     */
    revertToLead(id: string): Promise<Contact>;
    /** Soft-delete: archiva el contacto (se oculta de las listas, recuperable). */
    archive(id: string): Promise<Contact>;
    /** Restaura un contacto archivado. */
    unarchive(id: string): Promise<Contact>;
    /**
     * Hard-delete: borra el contacto y TODO su rastro (conversaciones, mensajes,
     * citas, pagos, expediente, archivos, prevaloraciones). DESTRUCTIVO e
     * irreversible — gated por ENABLE_CONTACT_DELETION (default OFF); preferimos
     * archive(). La UI siempre confirma antes de llamarlo.
     */
    delete(id: string): Promise<void>;
  };

  patientRecords: {
    get(id: string): Promise<PatientRecord>;
    getByContact(contactId: string): Promise<PatientRecord | null>;
    update(id: string, input: UpdatePatientRecordInput): Promise<PatientRecord>;
    listFiles(recordId: string): Promise<PatientFile[]>;
    addFile(
      recordId: string,
      file: {
        nombre: string;
        mimeType: string;
        sizeKb: number;
        category: PatientFileCategory;
      }
    ): Promise<PatientFile>;
  };

  notes: {
    listForRecord(recordId: string): Promise<ClinicalNote[]>;
    getForSession(sessionId: string): Promise<ClinicalNote | null>;
    update(
      id: string,
      partial: Partial<
        Pick<
          ClinicalNote,
          "motivo" | "exploracion" | "diagnostico" | "plan" | "notasExtra"
        >
      >
    ): Promise<ClinicalNote>;
    sign(id: string): Promise<ClinicalNote>;
  };

  customFields: {
    list(entityType?: "lead" | "paciente"): Promise<CustomFieldDef[]>;
    create(def: Omit<CustomFieldDef, "id" | "clinicId">): Promise<CustomFieldDef>;
    update(
      id: string,
      partial: Partial<Omit<CustomFieldDef, "id" | "clinicId">>
    ): Promise<CustomFieldDef>;
    remove(id: string): Promise<void>;
  };

  pipeline: {
    listStages(): Promise<PipelineStage[]>;
    updateStage(
      id: string,
      partial: Partial<Pick<PipelineStage, "label" | "color" | "order">>
    ): Promise<PipelineStage>;
  };

  preAssessments: {
    list(): Promise<PreAssessment[]>;
    getForContact(contactId: string): Promise<PreAssessment | null>;
    markReviewed(id: string): Promise<PreAssessment>;
  };

  appointments: {
    list(
      range: { from: IsoDateTime; to: IsoDateTime },
      filters?: AgendaFilters
    ): Promise<Appointment[]>;
    listForContact(contactId: string): Promise<Appointment[]>;
    get(id: string): Promise<Appointment>;
    create(input: CreateAppointmentInput): Promise<Appointment>;
    /** Parchea metadatos (título/motivo/sede/doctor). La hora va por reschedule. */
    update(id: string, input: UpdateAppointmentInput): Promise<Appointment>;
    reschedule(
      id: string,
      startsAt: IsoDateTime,
      endsAt: IsoDateTime,
      motivo?: string
    ): Promise<Appointment>;
    cancel(id: string, motivo?: string): Promise<Appointment>;
    /** Marca inasistencia. Solo desde estado activo (nueva/confirmada/reagendada); estados terminales se rechazan. */
    markNoShow(id: string, motivo?: string): Promise<Appointment>;
    /** Solo válida si el anticipo requerido ya está pagado (regla de oro). */
    confirm(id: string): Promise<Appointment>;
    /**
     * Slots libres para una fecha. Si se pasa `doctorUserId` y ese doctor tiene
     * un `DoctorSchedule` activo en la sede, usa su ventana y duración de slot;
     * si no, cae al `OpeningHours` de la sede (60 min) — retrocompatible.
     */
    availability(
      locationId: string,
      date: IsoDate,
      doctorUserId?: string
    ): Promise<AvailabilitySlot[]>;
    todayForDoctor(doctorUserId: string): Promise<Appointment[]>;
  };

  payments: {
    list(filters?: {
      contactId?: string;
      appointmentId?: string;
    }): Promise<Payment[]>;
    /**
     * Registra un pago. Si cubre el anticipo pendiente de la cita ligada,
     * la cita pasa a confirmada (la regla de negocio viva en la demo).
     */
    register(input: RegisterPaymentInput): Promise<Payment>;
    confirm(id: string): Promise<Payment>;
  };

  procedures: {
    list(soloActivos?: boolean): Promise<Procedure[]>;
    create(
      input: Omit<Procedure, "id" | "clinicId" | "updatedAt">
    ): Promise<Procedure>;
    update(
      id: string,
      partial: Partial<Omit<Procedure, "id" | "clinicId" | "updatedAt">>
    ): Promise<Procedure>;
    toggleActive(id: string): Promise<Procedure>;
  };

  catalogAssistant: {
    /** El doctor platica/dicta su catálogo → la IA propone borradores. */
    propose(sourceText: string): Promise<CatalogIntakeDraft>;
    /** Confirma (todos o por índice) y crea los Procedures. */
    confirm(draftId: string, indices?: number[]): Promise<Procedure[]>;
    discard(draftId: string): Promise<void>;
  };

  locations: {
    list(): Promise<Location[]>;
    /** Crea (sin id) o actualiza (con id) una sede de la clínica. */
    upsert(loc: Omit<Location, "clinicId" | "id"> & { id?: string }): Promise<Location>;
    remove(id: string): Promise<void>;
    hours(locationId: string): Promise<OpeningHours>;
    updateHours(locationId: string, week: WeekDayHours[]): Promise<OpeningHours>;
    /** Horarios por-doctor de la clínica (entidad distinta del OpeningHours de sede). */
    doctorSchedules(): Promise<DoctorSchedule[]>;
    /** Crea (sin id) o actualiza (con id) el horario de un doctor en una sede. */
    upsertDoctorSchedule(
      schedule: Omit<DoctorSchedule, "id" | "clinicId"> & { id?: string }
    ): Promise<DoctorSchedule>;
    policyWindows(): Promise<SchedulePolicyWindow[]>;
    upsertPolicyWindow(
      window: Omit<SchedulePolicyWindow, "id" | "clinicId"> & { id?: string }
    ): Promise<SchedulePolicyWindow>;
    removePolicyWindow(id: string): Promise<void>;
  };

  depositSettings: {
    get(): Promise<DepositSettings>;
    update(settings: DepositSettings): Promise<DepositSettings>;
  };

  consultations: {
    listRecent(doctorUserId?: string): Promise<ConsultationSession[]>;
    get(id: string): Promise<ConsultationSession>;
    getForAppointment(
      appointmentId: string
    ): Promise<ConsultationSession | null>;
    start(appointmentId: string): Promise<ConsultationSession>;
    /**
     * "Consulta rápida / sin cita" (walk-in): inicia una consulta SIN una cita
     * pre-existente. Crea el contacto, una cita walk-in (ahora) y la sesión en
     * "grabando" de forma atómica; devuelve la sesión lista para grabar.
     */
    startWalkIn(input: StartWalkInInput): Promise<ConsultationSession>;
    /** Turnos de transcript en vivo durante la grabación (simulado en mock). */
    subscribeTranscript(
      sessionId: string,
      cb: (session: ConsultationSession) => void
    ): Unsubscribe;
    /**
     * Termina la grabación → "procesando". En demo (navegador) completa inline.
     * En el engine (no-demo) devuelve la sesión en "procesando" y NO corre el
     * trabajo pesado: el motor llama `processConsultation` en background.
     */
    finish(id: string): Promise<ConsultationSession>;
    /**
     * Corre el trabajo pesado (transcripción Whisper + generación de documentos
     * IA) sobre una sesión en "procesando" y la marca "completada". Idempotente:
     * si la sesión no está "procesando", la devuelve sin cambios. Lo invoca el
     * engine en background tras `finish` y al recuperar tras un reinicio.
     */
    processConsultation(id: string): Promise<ConsultationSession>;
    /** Pausa la grabación (grabando → pausada); el transcript guionado deja de avanzar. */
    pause(id: string): Promise<ConsultationSession>;
    /** Reanuda la grabación (pausada → grabando). */
    resume(id: string): Promise<ConsultationSession>;
    /** Cancela la consulta (grabando/pausada → cancelada); estado terminal. */
    cancel(id: string): Promise<ConsultationSession>;
    /**
     * Edita el entregable extraído por la IA (resumen y/o accionables) para que el
     * doctor corrija errores de transcripción/LLM antes de producir el formato.
     */
    updateSummary(
      id: string,
      content: { resumen?: string; accionables?: string[] }
    ): Promise<ConsultationSession>;
    dailyDigest(doctorUserId: string, date: IsoDate): Promise<DailyDigest>;
  };

  documents: {
    listForRecord(recordId: string): Promise<GeneratedDocument[]>;
    getForSession(sessionId: string): Promise<GeneratedDocument[]>;
    /** Crea un documento (receta/cotización) en blanco para una sesión. */
    create(input: CreateDocumentInput): Promise<GeneratedDocument>;
    update(
      id: string,
      content: { receta?: PrescriptionContent; cotizacion?: QuoteContent }
    ): Promise<GeneratedDocument>;
    /** Aprueba: genera PDF (mock) y lo archiva al expediente/Drive. */
    approve(id: string): Promise<GeneratedDocument>;
    /** Envía el documento por WhatsApp (crea Message real en el chat). */
    sendByWhatsApp(id: string): Promise<GeneratedDocument>;
  };

  expenses: {
    list(filters?: {
      month?: string;
      categoria?: Expense["categoria"];
    }): Promise<Expense[]>;
    create(input: CreateExpenseInput): Promise<Expense>;
    /** Sube foto del ticket y simula OCR → datos pre-llenados editables. */
    uploadReceipt(
      imageDataUrl: string
    ): Promise<{ receiptImageUrl: string; ocr: OcrExtract }>;
    update(
      id: string,
      partial: Partial<CreateExpenseInput>
    ): Promise<Expense>;
    remove(id: string): Promise<void>;
  };

  financialReports: {
    dashboard(): Promise<FinanceDashboard>;
    list(): Promise<FinancialReport[]>;
    get(period: string): Promise<FinancialReport | null>;
    /**
     * Genera (o regenera, idempotente por período "YYYY-MM") el reporte mensual
     * a partir de los Payments confirmados y los Expenses del período. Calcula
     * alertas de presupuesto/utilidad por umbral. Devuelve el reporte resultante.
     */
    generate(period: string): Promise<FinancialReport>;
  };

  advisorChat: {
    history(): Promise<AdvisorChatMessage[]>;
    /** Devuelve el historial actualizado incluyendo la respuesta del consultor. */
    send(text: string): Promise<AdvisorChatMessage[]>;
  };

  /**
   * Concierge — el agente interno del equipo (agente `concierge`). Clinic-scoped
   * + user-scoped: el hilo es por usuario autenticado. `send` corre el agente y
   * devuelve los mensajes nuevos + las acciones `confirma` pendientes; las
   * acciones materiales (dinero, firmar docs) se ejecutan vía `confirmAction`.
   * Ver `packages/contracts/src/concierge.ts` (incl. el modelo de 3 tiers).
   */
  concierge: {
    history(): Promise<ConciergeMessage[]>;
    send(
      text: string,
      attachments?: ConciergeAttachment[]
    ): Promise<ConciergeTurnResult>;
    /** Ejecuta una acción `confirma` en estado `propuesta`. */
    confirmAction(actionId: string): Promise<ConciergeAction>;
    /** Rechaza una acción `propuesta`; no se ejecuta. */
    rejectAction(actionId: string, motivo?: string): Promise<ConciergeAction>;
    /** Borra el hilo del usuario (chat + acciones) para empezar de cero (tipo /reset). */
    clearHistory(): Promise<void>;
    /** Capacidades efectivas del usuario actual (RBAC por rol/clínica). */
    myCapabilities(): Promise<ConciergeCapability[]>;
    subscribe(cb: (message: ConciergeMessage) => void): Unsubscribe;
  };

  /**
   * Google Drive — archivo documental del expediente del paciente. Dominio de
   * nivel superior (no anidado en integrations) por el RPC/proxy de 2 niveles.
   * El nombrado/idempotencia de carpetas lo maneja el engine de forma
   * determinista. Ver `packages/contracts/src/drive.ts`.
   */
  googleDrive: {
    getStatus(): Promise<DriveStatus>;
    disconnect(): Promise<void>;
    listForRecord(patientRecordId: string): Promise<DriveFile[]>;
    upload(input: DriveUploadInput): Promise<DriveFile>;
    folderForRecord(patientRecordId: string): Promise<DriveFile>;
  };

  auditReports: {
    list(): Promise<AuditReport[]>;
    getByDate(date: IsoDate): Promise<AuditReport | null>;
    latest(): Promise<AuditReport>;
  };

  /**
   * Dominio `auditFindings` — auditor DETERMINISTA de congruencia. Corre reglas
   * sobre entidades + event log y produce hallazgos PERSISTENTES por entidad que
   * el doctor/asistente resuelve. La detección es determinista; la resolución
   * emite los eventos faltantes (`reconcilePatient`) → el profile se recompone.
   * Sin notificación aquí (el surface/escalación es aparte): esto es el motor.
   */
  auditFindings: {
    /** Lista los hallazgos de la clínica (por defecto solo los abiertos). */
    list(opts?: { includeResolved?: boolean }): Promise<AuditFinding[]>;
    /** Corre las reglas de congruencia y actualiza los hallazgos persistentes. */
    run(): Promise<AuditRunResult>;
    /** Resuelve un hallazgo aplicando su acción sugerida (1-click) y lo cierra. */
    resolve(findingId: string): Promise<AuditFinding>;
    /** Marca un hallazgo como ignorado (falso positivo / no accionar). */
    ignore(findingId: string): Promise<AuditFinding>;
  };

  notifications: {
    list(): Promise<NotificationEvent[]>;
    /** Crea una notificación interna (p.ej. el agente recepcionista avisa al equipo). */
    create(input: CreateNotificationInput): Promise<NotificationEvent>;
    unreadCount(): Promise<number>;
    markRead(id: string): Promise<void>;
    markAllRead(): Promise<void>;
    subscribe(cb: (event: NotificationEvent) => void): Unsubscribe;
  };

  agents: {
    list(): Promise<AgentConfig[]>;
    get(id: string): Promise<AgentConfig>;
    updateSection(
      agentId: string,
      sectionId: string,
      input: UpdatePromptSectionInput
    ): Promise<PromptSection>;
    toggleActive(agentId: string): Promise<AgentConfig>;
  };

  users: {
    list(): Promise<User[]>;
    create(input: CreateUserInput): Promise<User>;
    update(id: string, input: UpdateUserInput): Promise<User>;
    /**
     * Fija/reemplaza la contraseña de OTRO usuario (la asigna un admin, no
     * verifica la actual). Hashing scrypt en el engine; opcional como `login`
     * (el MockProvider de demo no lo implementa). Gateado a ADMIN por el RBAC
     * del `/rpc` (`users.setPassword` → tier ADMIN). El cambio de la PROPIA
     * contraseña es `auth.changePassword`.
     */
    setPassword?(userId: string, newPassword: string): Promise<void>;
  };

  blacklist: {
    list(): Promise<BlacklistEntry[]>;
    add(input: {
      phone: string;
      contactId?: string;
      motivo: string;
    }): Promise<BlacklistEntry>;
    remove(id: string): Promise<void>;
  };

  whatsappNumbers: {
    list(): Promise<WhatsAppNumber[]>;
  };

  integrations: {
    list(): Promise<IntegrationStatus[]>;
  };

  /**
   * Conexión de Google Calendar de la clínica activa. Dominio de nivel superior
   * (no anidado bajo integrations) porque el RPC/proxy es de 2 niveles.
   */
  googleCalendar: {
    getStatus(): Promise<GoogleCalendarConnection | null>;
    disconnect(): Promise<void>;
  };

  /** Configuración de la cuenta de WhatsApp Cloud API (Configuración → WhatsApp). */
  whatsappConfig: {
    get(): Promise<WhatsAppConfig>;
    update(input: UpdateWhatsAppConfigInput): Promise<WhatsAppConfig>;
  };

  /** Bitácora de los requests que Meta manda al webhook. */
  webhookLogs: {
    list(limit?: number): Promise<WebhookLog[]>;
  };

  settings: {
    get(): Promise<ClinicSettings>;
    update(input: UpdateClinicSettingsInput): Promise<ClinicSettings>;
  };

  demo: {
    /** Restaura el dataset semilla (borra el estado de localStorage). */
    reset(): Promise<void>;
  };

  /**
   * Dominio `events` — event log append-only del agentic-ERP (la espina dorsal).
   * Todo hecho de dominio se registra aquí; las proyecciones (profiles) se
   * derivan de esto. `emit` re-proyecta de forma síncrona los profiles afectados.
   */
  events: {
    emit(input: EmitEventInput): Promise<DomainEvent>;
    list(filters?: EventFilters): Promise<DomainEvent[]>;
  };

  /**
   * Dominio `profiles` — proyecciones agregadas por entidad (patient/doctor/
   * procedure/clinic). Lectura para agentes (contexto) y humanos (dashboards).
   */
  profiles: {
    get(
      entityType: ProfileEntityType,
      entityId: string
    ): Promise<EntityProfile | null>;
    list(entityType?: ProfileEntityType): Promise<EntityProfile[]>;
    /** Fuerza re-proyección (útil para backfill/depuración). */
    reproject(
      entityType: ProfileEntityType,
      entityId: string
    ): Promise<EntityProfile | null>;
  };

  /**
   * Dominio `patientProcedures` — proyección (compute-on-read) del journey
   * clínico del paciente: una instancia por cita de tipo "procedimiento", con su
   * etapa (preparacion/cuidado/seguimiento/mantenimiento) derivada del estado de
   * la cita + el tiempo, con override por evento `procedimiento_etapa_cambiada`.
   * Es la "capa 2 del panorama" que lee el agente de pacientes.
   */
  patientProcedures: {
    /** Procedimientos (con su etapa de journey) de un paciente. */
    listForContact(contactId: string): Promise<PatientProcedure[]>;
    /** Todos los procedimientos de la clínica (para UI/listados). */
    list(): Promise<PatientProcedure[]>;
  };

  /**
   * Dominio `assets` — registro canónico de binarios (datos no estructurados).
   * Los bytes viven en object storage (MinIO, vía AssetStore); aquí va metadata
   * + estado de ingesta. La ingesta real (STT/visión/embeddings) llega en fases.
   */
  assets: {
    create(input: CreateAssetInput): Promise<Asset>;
    get(id: string): Promise<Asset | null>;
    list(filters?: AssetFilters): Promise<Asset[]>;
    /** Persiste el resultado de la ingesta (STT/visión/OCR) y emite el evento. */
    setIngest(
      id: string,
      status: AssetIngestStatus,
      ingest?: AssetIngestResult
    ): Promise<Asset | null>;
  };

  /**
   * Dominio `admin` — "import-through-engine" (migración idempotente).
   *
   * Solo lo implementa el provider del engine (no el MockProvider del
   * frontend) y está gateado por `ALLOW_ADMIN_IMPORT==="true"` en el servidor
   * RPC. Cada `upsert*` resuelve por `(source, externalId)` y muta el único
   * `MockState` compartido a través de los métodos existentes del provider, de
   * modo que el engine es el único escritor (sin clobber por last-flush-wins).
   * Opcional en la interfaz porque el frontend no lo expone.
   */
  admin?: {
    /** Upsert idempotente de contactos por `(source, externalId)`. */
    upsertContacts(items: ImportContact[]): Promise<UpsertResult<Contact>>;
    /** Upsert de expedientes derivados, ligados al contacto por su llave externa. */
    upsertPatientRecords(
      items: ImportPatientRecord[]
    ): Promise<UpsertResult<PatientRecord>>;
    /** Upsert de pagos derivados, keyed por su `externalId` derivado. */
    upsertPayments(items: ImportPayment[]): Promise<UpsertResult<Payment>>;
    /** Upsert de citas; dedup por `(clinicId, calendarEventId)` o `(source, externalId)`. */
    upsertAppointments(
      items: ImportAppointment[]
    ): Promise<UpsertResult<Appointment>>;
    /** Dry-run: valida + reporta would-create/update/skip por entidad, sin mutar. */
    plan(batch: ImportBatch): Promise<ImportPlan>;
    /** Fuerza el flush pendiente del persist debounced (cierre determinista del CLI). */
    flush(): Promise<void>;
  };
}

/**
 * Contratos del módulo CRM de ClinicOS: expedientes de pacientes, pipeline de leads,
 * campos personalizados, prevaloración por fotos y línea de tiempo del contacto.
 */

import { z } from "zod";
import {
  IsoDateTimeSchema,
  IsoDateSchema,
  ActorSchema,
} from "./shared";

// ——— Enums ———

/** Tipo de campo personalizado que puede definir la clínica para sus entidades. */
export const CustomFieldTypeSchema = z.enum(["text", "number", "select", "date", "file"]);
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;

/** Tipo de entidad CRM a la que puede pertenecer un campo o registro. */
export const CrmEntityTypeSchema = z.enum(["lead", "paciente"]);
export type CrmEntityType = z.infer<typeof CrmEntityTypeSchema>;

/** Categoría de archivo adjunto al expediente del paciente. */
export const PatientFileCategorySchema = z.enum([
  "foto_clinica",
  "estudio",
  "consentimiento",
  "identificacion",
  "otro",
]);
export type PatientFileCategory = z.infer<typeof PatientFileCategorySchema>;

/** Estado del ciclo de vida de una prevaloración enviada por el paciente. */
export const PreAssessmentStatusSchema = z.enum(["enviada", "completada", "revisada"]);
export type PreAssessmentStatus = z.infer<typeof PreAssessmentStatusSchema>;

/** Tipo de evento que puede aparecer en la línea de tiempo del expediente. */
export const TimelineItemTypeSchema = z.enum([
  "cita",
  "pago",
  "nota_clinica",
  "clasificacion",
  "escalacion",
  "archivo",
  "conversacion",
]);
export type TimelineItemType = z.infer<typeof TimelineItemTypeSchema>;

/** Sexo biológico del paciente, tal como se registra en el expediente clínico. */
export const SexoSchema = z.enum(["femenino", "masculino", "otro"]);
export type Sexo = z.infer<typeof SexoSchema>;

// ——— Entidades ———

/**
 * Definición de un campo personalizado creado por la clínica para enriquecer
 * sus leads o expedientes de pacientes más allá de los campos estándar.
 */
export const CustomFieldDefSchema = z.object({
  /** Identificador único del campo (fld_). */
  id: z.string(),
  /** id de la clínica dueña de esta definición (cli_). */
  clinicId: z.string(),
  /** Entidad a la que aplica este campo: lead o paciente. */
  entityType: CrmEntityTypeSchema,
  /** Clave interna en snake_case, usada como key en customFields del registro. */
  key: z.string(),
  /** Etiqueta visible al usuario en el formulario. */
  label: z.string(),
  /** Tipo de control a renderizar para capturar el valor. */
  type: CustomFieldTypeSchema,
  /** Opciones válidas; solo aplica cuando type = "select". */
  options: z.array(z.string()).optional(),
  /** Si el campo es obligatorio al guardar el registro. */
  required: z.boolean(),
  /** Posición relativa dentro de la sección para ordenar el formulario. */
  order: z.number(),
  /** Nombre del grupo o sección visual donde se muestra el campo (opcional). */
  section: z.string().optional(),
});
export type CustomFieldDef = z.infer<typeof CustomFieldDefSchema>;

/**
 * Etapa del pipeline CRM.
 * Las 8 etapas default son: Nuevo lead, Consulta agendada, Seguimiento Post-Cita,
 * Procedimiento agendado, En Post-Operatorio, Procedimiento cancelado,
 * Consulta cancelada, Proceso terminado.
 */
export const PipelineStageSchema = z.object({
  /** Identificador único de la etapa (stg_). */
  id: z.string(),
  /** id de la clínica dueña de esta etapa (cli_). */
  clinicId: z.string(),
  /** Clave interna en snake_case para referenciar la etapa en código. */
  key: z.string(),
  /** Nombre visible en el tablero kanban. */
  label: z.string(),
  /**
   * Token de color para el badge de la etapa en la UI.
   * Valores esperados: "primary" | "success" | "warning" | "muted" | "destructive".
   */
  color: z.string(),
  /** Posición relativa para ordenar las columnas del pipeline. */
  order: z.number(),
  /** Indica que el lead finalizó su ciclo (no pasa a otra etapa). */
  isTerminal: z.boolean(),
  /**
   * Fase del proceso a la que pertenece la etapa. Define en cuál de los dos
   * tableros del CRM aparece: "lead" (embudo de venta) o "paciente"
   * (tratamiento clínico, ya convertido). Default "lead".
   */
  phase: z.enum(["lead", "paciente"]).default("lead"),
});
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

/**
 * Datos demográficos básicos del paciente.
 * Se almacenan como sub-objeto dentro de PatientRecord.
 */
export const PatientDemographicsSchema = z.object({
  /** Fecha de nacimiento en formato YYYY-MM-DD. */
  fechaNacimiento: IsoDateSchema.optional(),
  sexo: SexoSchema.optional(),
  /** Ciudad de residencia del paciente. */
  ciudad: z.string().optional(),
  /** Ocupación o profesión del paciente. */
  ocupacion: z.string().optional(),
});
export type PatientDemographics = z.infer<typeof PatientDemographicsSchema>;

/**
 * Antecedentes médicos del paciente en texto libre.
 * Cada campo es un resumen narrativo capturado por el personal clínico.
 */
export const PatientBackgroundSchema = z.object({
  /** Alergias conocidas (medicamentos, materiales, etc.). */
  alergias: z.string().optional(),
  /** Enfermedades crónicas o diagnósticos previos relevantes. */
  enfermedades: z.string().optional(),
  /** Medicamentos actuales o de uso habitual. */
  medicamentos: z.string().optional(),
  /** Antecedentes quirúrgicos relevantes. */
  quirurgicos: z.string().optional(),
});
export type PatientBackground = z.infer<typeof PatientBackgroundSchema>;

/**
 * Expediente clínico digital del paciente dentro de una clínica.
 * Vincula al contacto del CRM con su historial médico, archivos y campos personalizados.
 */
export const PatientRecordSchema = z.object({
  /** Identificador único del expediente (rec_). */
  id: z.string(),
  /** id de la clínica dueña del expediente (cli_). */
  clinicId: z.string(),
  /** id del Contact (cont_) dueño de este expediente. */
  contactId: z.string(),
  /** Datos demográficos del paciente. */
  demografia: PatientDemographicsSchema,
  /** Antecedentes médicos en texto libre. */
  antecedentes: PatientBackgroundSchema,
  /** Valores de campos personalizados definidos por la clínica (key → value). */
  customFields: z.record(z.string(), z.union([z.string(), z.number()])),
  /** URL de la carpeta de Google Drive con los archivos del paciente. */
  driveFolderUrl: z.string().optional(),
  /**
   * Indica que la identidad del paciente (nombre + WhatsApp) fue verificada
   * por el personal, evitando fuga de datos entre pacientes con nombre similar.
   */
  identityVerified: z.boolean(),
  /** Fecha-hora de creación del expediente en ISO 8601 UTC. */
  createdAt: IsoDateTimeSchema,
  /** Fecha-hora de la última modificación en ISO 8601 UTC. */
  updatedAt: IsoDateTimeSchema,
});
export type PatientRecord = z.infer<typeof PatientRecordSchema>;

/**
 * Archivo adjunto al expediente de un paciente (foto clínica, estudio, consentimiento, etc.).
 */
export const PatientFileSchema = z.object({
  /** Identificador único del archivo (file_). */
  id: z.string(),
  /** id de la clínica dueña del archivo (cli_). */
  clinicId: z.string(),
  /** id del expediente al que pertenece este archivo (rec_). */
  patientRecordId: z.string(),
  /** Nombre descriptivo del archivo para mostrar en la UI. */
  nombre: z.string(),
  /** Tipo MIME del archivo (ej. "image/jpeg", "application/pdf"). */
  mimeType: z.string(),
  /** Tamaño del archivo en kilobytes. */
  sizeKb: z.number(),
  /** URL pública o firmada para acceder al archivo. */
  url: z.string(),
  /** ID del archivo en Google Drive, si fue sincronizado. */
  driveFileId: z.string().optional(),
  /** Categoría clínica del archivo para filtrado y organización. */
  category: PatientFileCategorySchema,
  /** Actor (IA o usuario) que subió el archivo. */
  uploadedBy: ActorSchema,
  /** Fecha-hora de subida del archivo en ISO 8601 UTC. */
  createdAt: IsoDateTimeSchema,
});
export type PatientFile = z.infer<typeof PatientFileSchema>;

/** Par pregunta-respuesta de una prevaloración enviada por el paciente. */
export const PreAssessmentAnswerSchema = z.object({
  /** Texto de la pregunta tal como se presentó al paciente. */
  pregunta: z.string(),
  /** Respuesta libre del paciente a la pregunta. */
  respuesta: z.string(),
});
export type PreAssessmentAnswer = z.infer<typeof PreAssessmentAnswerSchema>;

/**
 * Prevaloración por fotos enviada por el paciente antes de la consulta.
 * Su creación origina la notificación de tipo "prevaloracion_lista" al equipo clínico.
 */
export const PreAssessmentSchema = z.object({
  /** Identificador único de la prevaloración (pre_). */
  id: z.string(),
  /** id de la clínica a la que pertenece esta prevaloración (cli_). */
  clinicId: z.string(),
  /** id del Contact (cont_) que envió la prevaloración. */
  contactId: z.string(),
  /** id del procedimiento de interés declarado por el paciente (proc_); opcional. */
  procedimientoInteresId: z.string().optional(),
  /** Respuestas al formulario de prevaloración. */
  respuestas: z.array(PreAssessmentAnswerSchema),
  /** URLs de las fotos de referencia enviadas por el paciente. */
  fotoUrls: z.array(z.string()),
  /** Estado actual del proceso de prevaloración. */
  status: PreAssessmentStatusSchema,
  /** Fecha-hora en que el paciente envió la prevaloración (ISO 8601 UTC). */
  submittedAt: IsoDateTimeSchema,
});
export type PreAssessment = z.infer<typeof PreAssessmentSchema>;

/**
 * Evento en la línea de tiempo del expediente del contacto.
 * Alimenta el feed del tab "Resumen" en el expediente dentro del CRM.
 */
export const TimelineItemSchema = z.object({
  /** Identificador único del evento. */
  id: z.string(),
  /** id del Contact (cont_) dueño de este evento de línea de tiempo. */
  contactId: z.string(),
  /** Tipo de evento que representa este item. */
  type: TimelineItemTypeSchema,
  /** Título corto del evento para mostrar en la línea de tiempo. */
  title: z.string(),
  /** Descripción adicional o contexto del evento. */
  description: z.string().optional(),
  /** id de la entidad referida (cita, pago, nota, etc.) según el tipo de evento. */
  refId: z.string().optional(),
  /** Fecha-hora en que ocurrió el evento (ISO 8601 UTC). */
  occurredAt: IsoDateTimeSchema,
});
export type TimelineItem = z.infer<typeof TimelineItemSchema>;

// ——— Filtros e inputs ———

/** Filtros para listar y buscar contactos en el CRM. */
export const ContactFiltersSchema = z.object({
  /** Tipo de contacto (lead, paciente, etc.) como string libre. */
  tipo: z.string().optional(),
  /** Clasificación asignada al contacto como string libre. */
  clasificacion: z.string().optional(),
  /** id de la etapa del pipeline por la que filtrar (stg_). */
  pipelineStageId: z.string().optional(),
  /** Texto libre para búsqueda por nombre, teléfono u otros campos. */
  busqueda: z.string().optional(),
  /** Incluir contactos ARCHIVADOS (soft-deleted). Default: false (se ocultan). */
  includeArchived: z.boolean().optional(),
});
export type ContactFilters = z.infer<typeof ContactFiltersSchema>;

/**
 * Campos actualizables del expediente del paciente.
 * Solo se aplican los campos presentes en el payload (partial update).
 */
export const UpdatePatientRecordInputSchema = z.object({
  /** Actualización parcial de los datos demográficos del paciente. */
  demografia: PatientDemographicsSchema.optional(),
  /** Actualización parcial de los antecedentes médicos del paciente. */
  antecedentes: PatientBackgroundSchema.optional(),
  /** Valores actualizados de campos personalizados (key → value). */
  customFields: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  /**
   * Marca si la identidad del paciente fue verificada por el personal.
   * Evita fuga de datos entre pacientes con nombre o número similar.
   */
  identityVerified: z.boolean().optional(),
});
export type UpdatePatientRecordInput = z.infer<typeof UpdatePatientRecordInputSchema>;

/**
 * Resultado de reconciliar el ciclo de vida de un paciente (event sourcing).
 * Re-emite los eventos de ciclo de vida faltantes y corrige el estado derivado
 * (etapa de pipeline, cita completada) de forma idempotente: "resolver vía el
 * sistema" en lugar de backfill manual. Devuelve una lista legible de qué cambió.
 */
export const PatientReconcileResultSchema = z.object({
  /** Contacto reconciliado. */
  contactId: z.string(),
  /** Correcciones de estado aplicadas (texto legible para el operador). */
  fixes: z.array(z.string()),
  /** Tipos de evento de dominio re-emitidos para rellenar el event log. */
  eventsEmitted: z.array(z.string()),
  /** True si no había nada que reconciliar (ya estaba congruente). */
  alreadyCongruent: z.boolean(),
});
export type PatientReconcileResult = z.infer<typeof PatientReconcileResultSchema>;

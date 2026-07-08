// ============================================================
// clinicOS — subida de documentos de paciente a Google Drive.
//
// Orquesta: token fresco de la cuenta → asegurar la carpeta del paciente
// (raíz "clinicOS" → "Pacientes" → carpeta del contacto, cacheada en
// `contacts.drive_folder_id`) → subir el archivo → indexar en
// `patient_documents`. Corre con el cliente service-role (igual que el
// resto de escrituras del lado servidor); autorización aparte en la ruta.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  DRIVE_PATIENTS_FOLDER_NAME,
  DRIVE_ROOT_FOLDER_NAME,
} from './config'
import { getFreshAccessToken } from './client'
import { ensureFolder, uploadFile } from './drive'

export class GoogleNotConnectedError extends Error {
  constructor() {
    super('La clínica no tiene Google conectado.')
    this.name = 'GoogleNotConnectedError'
  }
}

export interface UploadPatientDocumentArgs {
  /** Cliente service-role (lee google_connections, escribe archivos). */
  db: SupabaseClient
  accountId: string
  /** Quién sube (auth.users.id) — se guarda como uploaded_by. */
  userId: string | null
  contactId: string
  fileName: string
  mimeType: string
  bytes: Uint8Array
  category?: string | null
}

export interface PatientDocumentRow {
  id: string
  file_name: string
  mime_type: string
  drive_file_id: string
  drive_web_link: string | null
  size_bytes: number | null
  category: string | null
  created_at: string
}

/**
 * Sube un documento del paciente a Drive y lo indexa. Lanza
 * `GoogleNotConnectedError` si la cuenta no tiene Google conectado.
 */
export async function uploadPatientDocument(
  args: UploadPatientDocumentArgs,
): Promise<PatientDocumentRow> {
  const { db, accountId, userId, contactId, fileName, mimeType, bytes } = args

  const fresh = await getFreshAccessToken(db, accountId)
  if (!fresh) throw new GoogleNotConnectedError()
  const accessToken = fresh.accessToken
  const rootId =
    fresh.connection.drive_root_folder_id ||
    (await ensureFolder(accessToken, DRIVE_ROOT_FOLDER_NAME, null, null))

  const folderId = await ensurePatientFolder(db, accessToken, rootId, accountId, contactId)

  const uploaded = await uploadFile(accessToken, folderId, fileName, mimeType, bytes)

  const { data, error } = await db
    .from('patient_documents')
    .insert({
      account_id: accountId,
      contact_id: contactId,
      uploaded_by: userId,
      file_name: fileName,
      mime_type: mimeType,
      drive_file_id: uploaded.id,
      drive_web_link: uploaded.webViewLink,
      size_bytes: uploaded.size,
      category: args.category ?? null,
    })
    .select(
      'id, file_name, mime_type, drive_file_id, drive_web_link, size_bytes, category, created_at',
    )
    .single()
  if (error || !data) {
    throw new Error(`No se pudo indexar el documento: ${error?.message ?? 'desconocido'}`)
  }
  return data as PatientDocumentRow
}

/**
 * Devuelve el id de la carpeta de Drive del paciente, creando la ruta
 * "Pacientes/<contacto>" bajo la raíz si hace falta y cacheando el id en
 * `contacts.drive_folder_id`.
 */
async function ensurePatientFolder(
  db: SupabaseClient,
  accessToken: string,
  rootId: string,
  accountId: string,
  contactId: string,
): Promise<string> {
  const { data: contact } = await db
    .from('contacts')
    .select('name, phone, drive_folder_id')
    .eq('account_id', accountId)
    .eq('id', contactId)
    .maybeSingle()
  if (!contact) throw new Error('El contacto ya no existe.')

  const patientsId = await ensureFolder(
    accessToken,
    DRIVE_PATIENTS_FOLDER_NAME,
    rootId,
    null,
  )

  const label = contactFolderName(contact.name, contact.phone, contactId)
  const folderId = await ensureFolder(
    accessToken,
    label,
    patientsId,
    (contact.drive_folder_id as string | null) ?? null,
  )

  if (contact.drive_folder_id !== folderId) {
    await db
      .from('contacts')
      .update({ drive_folder_id: folderId })
      .eq('id', contactId)
      .eq('account_id', accountId)
  }
  return folderId
}

/** Nombre estable y legible de la carpeta del paciente. */
export function contactFolderName(
  name: string | null,
  phone: string | null,
  contactId: string,
): string {
  const base = (name || phone || 'Paciente').trim()
  return `${base} (${contactId.slice(0, 8)})`
}

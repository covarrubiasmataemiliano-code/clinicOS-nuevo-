// ============================================================
// clinicOS — API de Google Drive (REST).
//
// Scope `drive.file`: la app solo ve/gestiona los archivos y carpetas
// que ella misma crea. Estructura: una carpeta raíz "clinicOS", y dentro
// una subcarpeta por paciente donde se suben sus documentos.
// ============================================================

import {
  DRIVE_ROOT_FOLDER_NAME,
  GOOGLE_DRIVE_BASE,
  GOOGLE_DRIVE_UPLOAD_BASE,
} from './config'
import { googleFetch, GoogleApiError } from './rest'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

interface DriveFile {
  id: string
  name?: string
  mimeType?: string
  webViewLink?: string
  size?: string
}

interface DriveList {
  files?: DriveFile[]
}

/**
 * Devuelve el id de una carpeta con `name` bajo `parentId` (o en la raíz
 * si `parentId` es null), creándola si no existe. Si `existingId` sigue
 * siendo una carpeta válida, la reutiliza sin buscar.
 */
export async function ensureFolder(
  accessToken: string,
  name: string,
  parentId: string | null,
  existingId: string | null = null,
): Promise<string> {
  if (existingId) {
    try {
      const f = await googleFetch<DriveFile>(
        accessToken,
        `${GOOGLE_DRIVE_BASE}/files/${encodeURIComponent(existingId)}?fields=id,mimeType,trashed`,
      )
      if (f?.id && f.mimeType === FOLDER_MIME) return f.id
    } catch (err) {
      if (!(err instanceof GoogleApiError) || err.status !== 404) throw err
    }
  }

  // Buscar una carpeta existente con ese nombre (evita duplicados si el
  // id no se había guardado). `drive.file` solo lista lo que la app creó.
  const q = [
    `name = '${escapeQuery(name)}'`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
    parentId ? `'${escapeQuery(parentId)}' in parents` : "'root' in parents",
  ].join(' and ')
  const found = await googleFetch<DriveList>(
    accessToken,
    `${GOOGLE_DRIVE_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
  )
  const hit = found.files?.[0]
  if (hit?.id) return hit.id

  const created = await googleFetch<DriveFile>(
    accessToken,
    `${GOOGLE_DRIVE_BASE}/files?fields=id`,
    {
      method: 'POST',
      json: {
        name,
        mimeType: FOLDER_MIME,
        ...(parentId ? { parents: [parentId] } : {}),
      },
    },
  )
  return created.id
}

/** Carpeta raíz de la app ("clinicOS") en la cuenta de Drive conectada. */
export async function ensureRootFolder(
  accessToken: string,
  existingId: string | null,
): Promise<string> {
  return ensureFolder(accessToken, DRIVE_ROOT_FOLDER_NAME, null, existingId)
}

export interface UploadedFile {
  id: string
  webViewLink: string | null
  size: number | null
}

/**
 * Sube un archivo a `parentId` con multipart (metadatos + contenido en
 * una sola petición). Devuelve id + link para abrirlo.
 */
export async function uploadFile(
  accessToken: string,
  parentId: string,
  fileName: string,
  mimeType: string,
  content: ArrayBuffer | Uint8Array,
): Promise<UploadedFile> {
  const boundary = `clinicos-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const metadata = JSON.stringify({ name: fileName, parents: [parentId] })
  const bytes =
    content instanceof Uint8Array ? content : new Uint8Array(content)

  const enc = new TextEncoder()
  const pre = enc.encode(
    `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      metadata +
      `\r\n--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
  )
  const post = enc.encode(`\r\n--${boundary}--`)
  const bodyBuf = new Uint8Array(pre.length + bytes.length + post.length)
  bodyBuf.set(pre, 0)
  bodyBuf.set(bytes, pre.length)
  bodyBuf.set(post, pre.length + bytes.length)

  const created = await googleFetch<DriveFile>(
    accessToken,
    `${GOOGLE_DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,webViewLink,size`,
    {
      method: 'POST',
      body: bodyBuf,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    },
  )
  return {
    id: created.id,
    webViewLink: created.webViewLink ?? null,
    size: created.size ? Number(created.size) : bytes.length,
  }
}

/** Escapa comillas simples para las queries `q` de Drive. */
function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

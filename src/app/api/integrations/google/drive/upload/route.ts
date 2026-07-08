import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  GoogleNotConnectedError,
  uploadPatientDocument,
} from '@/lib/integrations/google/patient-files'

/** Tope de tamaño por archivo. */
const MAX_DOC_BYTES = 25 * 1024 * 1024 // 25 MB

/**
 * POST /api/integrations/google/drive/upload  (agent+)
 *
 * Sube un documento de paciente al Drive de la clínica (multipart form:
 * `file` + `contact_id` [+ `category`]) y lo indexa en patient_documents.
 * Autoriza con el rol del usuario; la subida corre server-side con el
 * cliente service-role (lee la conexión de Google, escribe archivos).
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`drive-upload:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const form = await request.formData().catch(() => null)
    if (!form) {
      return NextResponse.json({ error: 'multipart/form-data requerido' }, { status: 400 })
    }
    const file = form.get('file')
    const contactId = form.get('contact_id')
    const category = form.get('category')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })
    }
    if (typeof contactId !== 'string' || !contactId) {
      return NextResponse.json({ error: 'Falta contact_id' }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'El archivo está vacío' }, { status: 400 })
    }
    if (file.size > MAX_DOC_BYTES) {
      return NextResponse.json(
        { error: 'El archivo supera el máximo de 25 MB' },
        { status: 413 },
      )
    }

    const bytes = new Uint8Array(await file.arrayBuffer())

    const doc = await uploadPatientDocument({
      db: supabaseAdmin(),
      accountId,
      userId,
      contactId,
      fileName: file.name || 'documento',
      mimeType: file.type || 'application/octet-stream',
      bytes,
      category: typeof category === 'string' && category ? category : null,
    })

    return NextResponse.json({ document: doc })
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    return toErrorResponse(err)
  }
}

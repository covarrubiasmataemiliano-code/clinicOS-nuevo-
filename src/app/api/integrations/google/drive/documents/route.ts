import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/integrations/google/drive/documents?contact_id=...
 *
 * Lista los documentos de Drive de un paciente (cualquier miembro).
 * Lee con el cliente RLS del usuario, siempre acotado al contacto.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const contactId = new URL(request.url).searchParams.get('contact_id')
    if (!contactId) {
      return NextResponse.json({ error: 'contact_id requerido' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('patient_documents')
      .select(
        'id, file_name, mime_type, drive_file_id, drive_web_link, size_bytes, category, created_at',
      )
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ documents: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

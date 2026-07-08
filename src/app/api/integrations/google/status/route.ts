import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { isGoogleConfigured } from '@/lib/integrations/google/config'
import { getGoogleConnection } from '@/lib/integrations/google/client'

/**
 * GET /api/integrations/google/status  (cualquier miembro)
 *
 * Estado de la conexión de Google para la tarjeta de Settings:
 * si el entorno tiene OAuth configurado y si la cuenta ya está conectada
 * (correo + calendario). No expone tokens.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const connection = await getGoogleConnection(supabase, accountId)
    return NextResponse.json({
      configured: isGoogleConfigured(),
      connected: !!connection,
      email: connection?.google_email ?? null,
      calendar_id: connection?.calendar_id ?? null,
      drive_ready: !!connection?.drive_root_folder_id,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

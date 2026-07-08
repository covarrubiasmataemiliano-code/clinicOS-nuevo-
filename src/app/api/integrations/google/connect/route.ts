import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  isGoogleConfigured,
  settingsResultUrl,
} from '@/lib/integrations/google/config'
import { buildAuthUrl } from '@/lib/integrations/google/oauth'
import { signOAuthState } from '@/lib/integrations/google/oauth-state'

/**
 * GET /api/integrations/google/connect  (admin+)
 *
 * Arranca el consentimiento de Google: firma un `state` que ata cuenta+
 * usuario (anti-CSRF, ver oauth-state) y redirige a la pantalla de
 * consentimiento. Al volver, el callback lo verifica y guarda la
 * conexión. Una sola conexión por cuenta (nivel cuenta, no por doctor).
 */
export async function GET() {
  try {
    const { accountId, userId } = await requireRole('admin')

    if (!isGoogleConfigured()) {
      return NextResponse.redirect(
        settingsResultUrl('error', 'google_not_configured'),
      )
    }

    const state = signOAuthState({ accountId, userId })
    return NextResponse.redirect(buildAuthUrl(state))
  } catch (err) {
    return toErrorResponse(err)
  }
}

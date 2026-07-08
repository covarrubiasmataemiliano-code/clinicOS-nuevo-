import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runDueCalendarSyncJobs } from '@/lib/integrations/google/sync-runner'

/**
 * GET /api/integrations/google/calendar/sync
 *
 * Drena la cola `calendar_sync_jobs` y refleja las citas del panel en el
 * calendario "Clínica" de Google (una sola ida). Pensado para un pinger
 * externo en intervalo corto (igual que /api/automations/cron).
 *
 * Protegido por `x-cron-secret` contra GOOGLE_SYNC_CRON_SECRET; si no
 * está definido, cae a AUTOMATION_CRON_SECRET (mismo pinger). Sin ningún
 * secreto configurado responde 503 (feature apagada).
 */
export async function GET(request: Request) {
  const expected =
    process.env.GOOGLE_SYNC_CRON_SECRET || process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'sync cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runDueCalendarSyncJobs(supabaseAdmin())
  return NextResponse.json(result)
}

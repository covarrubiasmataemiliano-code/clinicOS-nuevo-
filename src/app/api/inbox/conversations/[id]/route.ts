// ============================================================
// DELETE /api/inbox/conversations/{id}
//
// "Eliminar conversación": borra la conversación por completo. La FK
// ON DELETE CASCADE de `messages` y `message_reactions` arrastra todo
// el historial. Acción destructiva e irreversible — el panel la
// confirma con advertencia explícita de borrado permanente.
//
// Auth: sesión del dashboard. Verificamos pertenencia con el cliente
// RLS y borramos con service-role (borrado + cascada garantizados).
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // RLS: sólo conversaciones de la cuenta del usuario. Id ajeno → 404.
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (convErr || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Borrado con service-role — messages + message_reactions caen por
    // ON DELETE CASCADE (migraciones 001 y 009).
    const { error: delErr } = await supabaseAdmin()
      .from('conversations')
      .delete()
      .eq('id', id)
    if (delErr) {
      console.error('[inbox/delete] error deleting conversation:', delErr)
      return NextResponse.json(
        { error: 'Failed to delete conversation' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[inbox/delete] unexpected error:', error)
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 })
  }
}

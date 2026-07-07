// ============================================================
// POST /api/inbox/conversations/{id}/clear
//
// "Limpiar conversación": borra TODOS los mensajes (y sus reacciones)
// del hilo, conservando la conversación y el contacto. Acción
// destructiva e irreversible — el panel la confirma con advertencia.
//
// Auth: sesión del dashboard. Verificamos que el hilo pertenece a la
// cuenta del usuario con el cliente RLS (sólo ve sus conversaciones) y
// luego borramos con service-role para garantizar el borrado completo
// sin depender de las policies de RLS de `messages`.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function POST(
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

    // RLS deja ver sólo las conversaciones de la cuenta del usuario, así
    // que un id ajeno (o inexistente) no aparece → 404.
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (convErr || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const admin = supabaseAdmin()

    // Reacciones primero (por si algún FK no cascada al borrar mensajes).
    const { error: reactErr } = await admin
      .from('message_reactions')
      .delete()
      .eq('conversation_id', id)
    if (reactErr) {
      console.error('[inbox/clear] error deleting reactions:', reactErr)
    }

    const { error: msgErr } = await admin
      .from('messages')
      .delete()
      .eq('conversation_id', id)
    if (msgErr) {
      console.error('[inbox/clear] error deleting messages:', msgErr)
      return NextResponse.json(
        { error: 'Failed to clear messages' },
        { status: 500 },
      )
    }

    // Deja el hilo vacío pero utilizable.
    await admin
      .from('conversations')
      .update({
        last_message_text: null,
        last_message_at: null,
        unread_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[inbox/clear] unexpected error:', error)
    return NextResponse.json({ error: 'Failed to clear conversation' }, { status: 500 })
  }
}

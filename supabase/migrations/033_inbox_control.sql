-- ============================================================
-- 033_inbox_control.sql
--
-- Panel de Conversaciones — control humano + envío por Zernio.
--
-- 1) conversations.zernio_conversation_id
--    Guarda el id de conversación de INBOX de Zernio para que el panel
--    pueda responder (texto y adjuntos) por la vía correcta:
--      POST /v1/inbox/conversations/{id}/messages
--    Sin esta columna sólo el auto-reply (que recibe el id transitorio
--    del webhook) podía contestar; un humano en el panel no tenía cómo
--    resolver la conversación de Zernio. Se rellena en cada inbound
--    (src/lib/zernio/inbound.ts) y lo consume el core de envío
--    (src/lib/whatsapp/send-message.ts).
--
-- 2) chat-media: aceptar CUALQUIER tipo de archivo
--    El bucket traía una allow-list acotada (PDF/Office/imágenes/audio).
--    El usuario quiere poder enviar cualquier documento (zip, etc.), así
--    que quitamos la restricción de MIME (NULL = todos) y subimos el
--    tope a 100 MB (límite de documentos de WhatsApp Cloud API). Las
--    imágenes/vídeo siguen validándose por tipo en el cliente antes de
--    subir; la validación dura de WhatsApp la aplica Meta al enviar.
--
-- 3) Política RLS de DELETE en messages
--    "Limpiar conversación" borra los mensajes conservando el hilo. No
--    existía policy de DELETE en messages (sólo cascada al borrar la
--    conversación). Las rutas de servidor usan service-role, pero
--    añadimos la policy para que un miembro de la cuenta pueda borrar
--    mensajes de sus conversaciones también por RLS.
--
-- Idempotente — seguro re-ejecutar.
-- ============================================================

-- 1) Zernio inbox conversation id -----------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS zernio_conversation_id text;

COMMENT ON COLUMN conversations.zernio_conversation_id IS
  'Zernio inbox conversation id — habilita el envío freeform (texto/adjuntos) desde el panel hacia WhatsApp vía POST /v1/inbox/conversations/{id}/messages. NULL para conversaciones que no llegaron por Zernio.';

-- 2) chat-media: cualquier tipo de archivo, hasta 100 MB ------------------
UPDATE storage.buckets
SET
  allowed_mime_types = NULL,      -- NULL = sin restricción de MIME
  file_size_limit = 104857600     -- 100 MB (tope de documentos de WhatsApp)
WHERE id = 'chat-media';

-- 3) RLS: un agente de la cuenta puede borrar mensajes de sus hilos -------
DROP POLICY IF EXISTS messages_delete ON messages;
CREATE POLICY messages_delete ON messages
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND is_account_member(c.account_id, 'agent')
    )
  );

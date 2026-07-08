-- ============================================================
-- 045_google_connection.sql — clinicOS: conexión con Google (OAuth)
--
-- Una sola conexión de Google por CUENTA (como whatsapp_config): un
-- admin conecta el Google de la clínica una vez, y de ahí salen tanto
-- el calendario "Clínica" (para reflejar las citas del panel) como el
-- Drive (documentos de pacientes y respaldos). Los doctores se
-- suscriben a ese calendario desde su propio Google.
--
-- Tokens: access_token y refresh_token se guardan CIFRADOS (AES-256-GCM,
-- misma llave/rutina que whatsapp_config — src/lib/whatsapp/encryption).
-- Nunca en claro, ni en el prompt, ni en logs.
--
-- RLS: settings-class, igual que whatsapp_config — lectura para
-- cualquier miembro, escritura admin+. El cron de sincronización lee/
-- escribe con el cliente service-role.
--
-- Idempotente — seguro de correr varias veces.
-- ============================================================

CREATE TABLE IF NOT EXISTS google_connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  -- Quién conectó (auditoría). NULL si el usuario se borró después.
  connected_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  google_email          text,                     -- correo de la cuenta conectada
  access_token          text NOT NULL,            -- cifrado
  refresh_token         text NOT NULL,            -- cifrado
  token_expires_at      timestamptz,              -- caducidad del access_token
  scopes                text[] NOT NULL DEFAULT '{}',
  -- Calendario destino de las citas ('primary' o el id de un calendario
  -- "Clínica" dedicado que se crea al conectar).
  calendar_id           text,
  -- Carpeta raíz de Drive donde cuelgan pacientes y respaldos.
  drive_root_folder_id  text,
  status                text NOT NULL DEFAULT 'connected'
                          CHECK (status IN ('connected', 'disconnected')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_connections_account
  ON google_connections(account_id);

ALTER TABLE google_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_connections_select ON google_connections;
CREATE POLICY google_connections_select ON google_connections FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS google_connections_write ON google_connections;
CREATE POLICY google_connections_write ON google_connections FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS google_connections_updated_at ON google_connections;
CREATE TRIGGER google_connections_updated_at
  BEFORE UPDATE ON google_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_clinic_updated_at();

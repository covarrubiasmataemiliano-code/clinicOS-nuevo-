-- ============================================================
-- 047_patient_documents.sql — clinicOS: documentos de paciente en Drive
--
-- Cada paciente puede tener archivos (consentimientos, estudios,
-- comprobantes) guardados en el Google Drive de la clínica (conexión de
-- la migración 045). Estructura en Drive: raíz "clinicOS" → "Pacientes"
-- → carpeta por contacto. `contacts.drive_folder_id` cachea esa carpeta.
--
-- Esta tabla es el índice en BD: qué archivo, de qué paciente, con su id
-- y link de Drive. El binario vive en Drive; aquí solo metadatos.
--
-- Aislamiento (lección Acerotech): cada fila cuelga de (account_id,
-- contact_id); se lista SIEMPRE por contacto. ON DELETE CASCADE con el
-- contacto — el botón rojo del panel arrasa también el índice (el
-- archivo en Drive queda; borrarlo allá es decisión aparte).
--
-- RLS: clase operativa (igual que appointments/payments) — lectura
-- miembro, escritura agent+. La subida corre server-side (service-role)
-- filtrando por account/contact en código.
--
-- Idempotente — seguro de correr varias veces.
-- ============================================================

CREATE TABLE IF NOT EXISTS patient_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  uploaded_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL = subido por proceso/agente
  file_name       text NOT NULL,
  mime_type       text NOT NULL DEFAULT 'application/octet-stream',
  drive_file_id   text NOT NULL,
  drive_web_link  text,
  size_bytes      bigint,
  category        text,                                -- ej. 'consentimiento', 'estudio', 'comprobante'
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_documents_contact
  ON patient_documents(account_id, contact_id, created_at DESC);

ALTER TABLE patient_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_documents_select ON patient_documents;
CREATE POLICY patient_documents_select ON patient_documents FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS patient_documents_write ON patient_documents;
CREATE POLICY patient_documents_write ON patient_documents FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- Carpeta de Drive del paciente (creada perezosamente al primer archivo).
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS drive_folder_id text;

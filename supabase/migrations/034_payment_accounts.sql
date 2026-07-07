-- ============================================================
-- 034_payment_accounts.sql — clinicOS: datos bancarios para anticipos
--
-- El flujo de anticipo (migración 031) deja un hueco: el agente aparta
-- la cita y pide el comprobante, pero no tiene de dónde sacar los datos
-- bancarios para que el paciente transfiera. Regla del negocio (script
-- de ventas legacy): los datos duros viven en la BD y el agente los
-- consulta con una herramienta (`consultar_datos_pago`) — NUNCA los
-- dicta de memoria ni van en el prompt.
--
--   - `payment_accounts`  cuentas bancarias oficiales de la clínica
--                         (banco, titular, CLABE/cuenta, indicaciones).
--   - nuevo tipo de notificación 'ai_appointment_cancelled' para la
--     herramienta `cancelar_cita`.
--
-- RLS: settings-class, igual que `procedures`/`clinic_hours` — lectura
-- para cualquier miembro, escritura admin+. El agente lee con el
-- cliente service-role filtrando por account_id en código.
--
-- Idempotente — seguro de correr varias veces.
-- ============================================================

-- ------------------------------------------------------------
-- Cuentas bancarias de la clínica
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bank            text NOT NULL,                       -- ej. 'BBVA'
  holder          text NOT NULL,                       -- a nombre de quién
  clabe           text,                                -- CLABE interbancaria
  account_number  text,                                -- número de cuenta / tarjeta
  instructions    text,                                -- ej. 'Envía tu comprobante por aquí'
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_accounts_account
  ON payment_accounts(account_id) WHERE is_active;

ALTER TABLE payment_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_accounts_select ON payment_accounts;
CREATE POLICY payment_accounts_select ON payment_accounts FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS payment_accounts_write ON payment_accounts;
CREATE POLICY payment_accounts_write ON payment_accounts FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS payment_accounts_updated_at ON payment_accounts;
CREATE TRIGGER payment_accounts_updated_at
  BEFORE UPDATE ON payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_clinic_updated_at();

-- ------------------------------------------------------------
-- Tipo de notificación para cancelaciones hechas por el agente
-- (mismo patrón idempotente que la migración 032).
-- ------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'ai_escalation',            -- el agente pasó la conversación a un humano
    'ai_deposit_prevalidated',  -- el agente prevalidó un anticipo (falta confirmar)
    'ai_appointment_created',   -- el agente apartó/agendó una cita (falta confirmar)
    'ai_appointment_cancelled'  -- el agente canceló una cita a petición del paciente
  ));

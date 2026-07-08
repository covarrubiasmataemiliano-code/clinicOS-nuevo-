-- ============================================================
-- 046_calendar_sync.sql — clinicOS: sincronización de agenda → Google
--
-- Refleja las citas del panel en el calendario "Clínica" de Google (una
-- sola ida; el panel es la fuente de verdad). Patrón cola outbox + cron,
-- igual que automation_pending_executions:
--
--   * Un TRIGGER sobre `appointments` encola un job cuando la cita nace,
--     cambia algo relevante, o se borra. Así se capturan los TRES
--     caminos de escritura (agente WhatsApp service-role, Concierge y
--     diálogos del panel) sin tocar ningún call site.
--   * El cron (/api/integrations/google/calendar/sync) drena los jobs,
--     hace upsert/delete del evento en Google y guarda el mapeo en
--     `calendar_event_links`.
--
-- Anti-bucle: el cron escribe en `calendar_event_links`, NUNCA en
-- `appointments`. Así el trigger no se re-dispara al guardar el
-- google_event_id. Además el trigger solo encola en UPDATE si cambió un
-- campo que afecta al evento (ignora updated_at y bookkeeping).
--
-- Idempotente — seguro de correr varias veces.
-- ============================================================

-- ------------------------------------------------------------
-- Mapeo cita ↔ evento de Google (una fila por cita sincronizada)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_event_links (
  appointment_id     uuid PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  google_calendar_id text NOT NULL,
  google_event_id    text NOT NULL,
  etag               text,
  last_synced_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_links_account
  ON calendar_event_links(account_id);

ALTER TABLE calendar_event_links ENABLE ROW LEVEL SECURITY;
-- Solo lectura para miembros (auditoría); la escritura es del cron
-- (service-role, que salta RLS). Sin políticas de escritura de cliente.
DROP POLICY IF EXISTS calendar_event_links_select ON calendar_event_links;
CREATE POLICY calendar_event_links_select ON calendar_event_links FOR SELECT
  USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- Cola de sincronización (drenada por el cron)
--
-- Sin FK a appointments a propósito: el trigger BEFORE INSERT encola con
-- el id de una cita que aún no existe, y un DELETE encola tras la cita
-- ya borrada. El cron tolera citas ausentes.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_sync_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  appointment_id     uuid NOT NULL,
  operation          text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  -- Para DELETE se captura el evento a borrar antes de que el link
  -- caiga por cascade (la cita ya no se podrá leer en el cron).
  google_event_id    text,
  google_calendar_id text,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts           integer NOT NULL DEFAULT 0,
  last_error         text,
  run_at             timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_jobs_due
  ON calendar_sync_jobs(status, run_at);

ALTER TABLE calendar_sync_jobs ENABLE ROW LEVEL SECURITY;
-- Service-role only (sin políticas de cliente). account_id queda en la
-- fila para que el cron consulte por cuenta.

-- ------------------------------------------------------------
-- Trigger que encola los cambios de la agenda
--
-- SECURITY DEFINER (dueño postgres): la función escribe en
-- calendar_sync_jobs, que tiene RLS activo SIN política de escritura de
-- cliente. Los tres caminos de escritura de citas incluyen usuarios con
-- cliente RLS (diálogos del panel, confirmación del Concierge); sin
-- DEFINER, ese INSERT del trigger sería denegado por RLS y tumbaría la
-- creación/edición de la cita. Como DEFINER corre con privilegios del
-- dueño, encola sin exponer la cola a los clientes.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_calendar_sync()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link calendar_event_links%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO calendar_sync_jobs(account_id, appointment_id, operation)
      VALUES (NEW.account_id, NEW.id, 'upsert');
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Solo si cambió algo que afecta al evento de Google. Ignora
    -- updated_at y cualquier bookkeeping → evita ruido y re-disparos.
    IF (NEW.starts_at   IS DISTINCT FROM OLD.starts_at
        OR NEW.ends_at     IS DISTINCT FROM OLD.ends_at
        OR NEW.status      IS DISTINCT FROM OLD.status
        OR NEW.contact_id  IS DISTINCT FROM OLD.contact_id
        OR NEW.procedure_id IS DISTINCT FROM OLD.procedure_id
        OR NEW.notes       IS DISTINCT FROM OLD.notes
        OR NEW.doctor_id   IS DISTINCT FROM OLD.doctor_id) THEN
      INSERT INTO calendar_sync_jobs(account_id, appointment_id, operation)
        VALUES (NEW.account_id, NEW.id, 'upsert');
    END IF;
    RETURN NEW;

  ELSE -- DELETE (BEFORE, para leer el link antes del cascade)
    SELECT * INTO v_link FROM calendar_event_links
      WHERE appointment_id = OLD.id;
    INSERT INTO calendar_sync_jobs(
        account_id, appointment_id, operation, google_event_id, google_calendar_id)
      VALUES (
        OLD.account_id, OLD.id, 'delete', v_link.google_event_id, v_link.google_calendar_id);
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION public.enqueue_calendar_sync() OWNER TO postgres;

-- BEFORE en las tres operaciones: en INSERT el id ya está resuelto (el
-- default corre antes del trigger BEFORE); en DELETE el link aún existe.
DROP TRIGGER IF EXISTS appointments_calendar_sync ON appointments;
CREATE TRIGGER appointments_calendar_sync
  BEFORE INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_calendar_sync();

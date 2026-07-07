-- ============================================================
-- 032_clinical_agent.sql — clinicOS: agente de Atención con tool-calling
--
-- La capa de IA de wacrm (migración 029) es una sola completación de
-- texto. clinicOS la convierte, para las cuentas de clínica, en un
-- agente con herramientas (loop de tool-use) que consulta el catálogo
-- y la agenda, prevalida anticipos y agenda citas sobre las tablas de
-- la migración 031 — siempre respetando la regla de oro: la IA solo
-- PREVALIDA (deja todo 'pendiente'); un humano confirma en el panel.
--
-- Este cambio de esquema es mínimo y aditivo:
--   1) un interruptor por cuenta para activar el agente clínico, y
--   2) ampliar los tipos de `notifications` para que el agente deje
--      avisos internos (escalación, anticipo prevalidado, cita creada)
--      en la sección Notificaciones — así "todo se comunica entre sí".
--
-- Idempotente — seguro de correr varias veces.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Interruptor del agente clínico (por cuenta)
--
-- Cuando está en true Y el proveedor es 'anthropic', el auto-reply usa
-- el loop de tool-use en vez de la completación simple. Default false
-- para no alterar cuentas wacrm genéricas; el seed de la clínica lo
-- pone en true.
-- ------------------------------------------------------------
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS clinical_agent_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ai_configs.clinical_agent_enabled IS
  'Cuando true (y provider=anthropic) el auto-reply corre el agente de Atención con herramientas clínicas (migración 031) en vez de una sola completación de texto.';

-- ------------------------------------------------------------
-- 2) Ampliar los tipos de notificación
--
-- El CHECK original (migración 027) solo permitía 'conversation_assigned'.
-- El agente de Atención necesita dejar avisos internos accionables para
-- el equipo. La UI de Notificaciones ya renderiza title/body de forma
-- genérica y cae a un icono por defecto para tipos desconocidos, así
-- que ampliar el dominio es seguro.
--
-- El CHECK inline de la migración 027 queda con el nombre por defecto
-- `notifications_type_check`; lo reemplazamos de forma idempotente.
-- ------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'ai_escalation',            -- el agente pasó la conversación a un humano
    'ai_deposit_prevalidated',  -- el agente prevalidó un anticipo (falta confirmar)
    'ai_appointment_created'    -- el agente apartó/agendó una cita (falta confirmar)
  ));

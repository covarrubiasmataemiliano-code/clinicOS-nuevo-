-- ============================================================
-- 044_doctors.sql — clinicOS: base multi-doctor de la agenda
--
-- Hasta ahora la agenda es UN solo calendario por cuenta: la cita no
-- sabe de qué doctor es. Esta migración agrega el concepto mínimo de
-- "doctor" para poder asignar y filtrar la agenda por doctor (en el
-- panel y, más adelante, colorear el evento en Google Calendar).
--
-- Decisión de producto: "doctor = usuario del panel" (cada doctor tiene
-- login propio). Por eso NO se crea una tabla `doctors` dedicada — un
-- doctor es un `profiles` con `is_provider = true`, respetando el modelo
-- existente donde la membresía vive en `profiles`. Si más adelante hacen
-- falta doctores sin login, horarios/zonas por doctor, se migra a una
-- tabla propia.
--
-- `appointments.doctor_id` es NULLABLE: una clínica de un solo doctor
-- (como Oranza hoy) funciona sin asignar nada y nada se rompe.
--
-- RLS: no se agregan políticas — son columnas sobre tablas que ya están
-- protegidas (profiles por su propio dueño, appointments por cuenta).
--
-- Idempotente — seguro de correr varias veces.
-- ============================================================

-- ------------------------------------------------------------
-- Marca de doctor sobre el perfil + color para la agenda
-- ------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_provider   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_color text;   -- hex '#RRGGBB' para la rejilla y el colorId de Google

-- Lista de "doctores asignables" = perfiles con is_provider dentro de la cuenta.
CREATE INDEX IF NOT EXISTS idx_profiles_providers
  ON profiles(account_id) WHERE is_provider;

-- ------------------------------------------------------------
-- Doctor asignado a la cita (opcional)
-- ------------------------------------------------------------
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_doctor
  ON appointments(account_id, doctor_id, starts_at);

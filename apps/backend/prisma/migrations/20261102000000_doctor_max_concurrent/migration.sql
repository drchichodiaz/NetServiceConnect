-- Cuantos pacientes atiende un doctor a la vez. 1 = como hasta ahora.
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "maxConcurrent" INTEGER NOT NULL DEFAULT 1;

-- La restriccion de exclusion solo sabe "libre u ocupado". Con mas de un paciente a la
-- vez la base tiene que contar, y eso lo hace un trigger: bloquea la fila del doctor
-- (dos reservas del mismo doctor al mismo tiempo se esperan una a la otra) y cuenta
-- cuantas citas activas tiene en el momento mas cargado del horario nuevo.
ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS "Appointment_no_overlap";

CREATE OR REPLACE FUNCTION appointment_capacity_check() RETURNS trigger AS $fn$
DECLARE
  cap INTEGER;
  peak INTEGER;
BEGIN
  IF NEW."status" = 'CANCELLED' THEN
    RETURN NEW;
  END IF;
  -- Cambiar el estado o las notas de una cita que ya estaba no ocupa nada nuevo: si se
  -- bajo el tope despues de agendar, igual se tiene que poder confirmar.
  IF TG_OP = 'UPDATE' AND OLD."status" <> 'CANCELLED'
     AND NEW."doctorId" = OLD."doctorId" AND NEW."startsAt" = OLD."startsAt" AND NEW."endsAt" = OLD."endsAt" THEN
    RETURN NEW;
  END IF;

  SELECT "maxConcurrent" INTO cap FROM "Doctor" WHERE "id" = NEW."doctorId" FOR UPDATE;

  -- El maximo de citas simultaneas cae siempre en el comienzo de alguna: el de la nueva
  -- o el de una que empieza mientras dura.
  SELECT COALESCE(MAX((
    SELECT count(*) FROM "Appointment" a
    WHERE a."doctorId" = NEW."doctorId" AND a."id" <> NEW."id" AND a."status" <> 'CANCELLED'
      AND a."startsAt" <= p.t AND a."endsAt" > p.t
  )), 0) INTO peak
  FROM (
    SELECT NEW."startsAt" AS t
    UNION
    SELECT a."startsAt" FROM "Appointment" a
    WHERE a."doctorId" = NEW."doctorId" AND a."id" <> NEW."id" AND a."status" <> 'CANCELLED'
      AND a."startsAt" > NEW."startsAt" AND a."startsAt" < NEW."endsAt"
  ) p;

  IF peak >= COALESCE(cap, 1) THEN
    RAISE EXCEPTION 'Appointment_capacity: el doctor ya tiene % cita(s) en ese horario', peak USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Appointment_capacity" ON "Appointment";
CREATE TRIGGER "Appointment_capacity"
  BEFORE INSERT OR UPDATE ON "Appointment"
  FOR EACH ROW EXECUTE FUNCTION appointment_capacity_check();

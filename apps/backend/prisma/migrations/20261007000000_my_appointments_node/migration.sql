-- Opcion de menu "Mis citas": el paciente ve sus proximas citas y, si la clinica lo
-- permite, las cambia o cancela. Aditiva.
ALTER TYPE "MenuNodeType" ADD VALUE IF NOT EXISTS 'MY_APPOINTMENTS';

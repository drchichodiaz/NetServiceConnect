import { PrismaService } from '../prisma/prisma.service';

/**
 * Las lineas donde el bot puede ofrecer citas: las que tienen turnos de un doctor general
 * activo. No hay un interruptor por linea, y a los especialistas no se les asigna una
 * cita sola, asi que sus turnos no cuentan. Null = la empresa no tiene agenda.
 *
 * Una linea sin doctores no da ningun error: el bot contesta que no hay horarios y deriva,
 * igual que si la agenda estuviera llena. Esto es lo que permite avisarlo en pantalla.
 */
export async function linesWithDoctors(prisma: PrismaService, tenantId: string): Promise<Set<string> | null> {
  const [settings, shifts] = await Promise.all([
    prisma.agendaSettings.findUnique({ where: { tenantId }, select: { enabled: true } }),
    prisma.doctorShift.findMany({
      where: { tenantId, doctor: { isActive: true, isSpecialist: false } },
      select: { channelAccountId: true },
      distinct: ['channelAccountId'],
    }),
  ]);
  if (!settings?.enabled) return null;
  return new Set(shifts.map((s) => s.channelAccountId));
}

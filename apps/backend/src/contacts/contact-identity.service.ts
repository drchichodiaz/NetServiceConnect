import { Injectable, Logger } from '@nestjs/common';
import { Channel, Contact } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Datos de perfil que manda el canal junto al mensaje. Todos opcionales: Meta no
 *  garantiza ninguno, y en Messenger el handle directamente no existe. */
export interface IdentityProfile {
  name?: string | null;
  /** @usuario en Instagram. WhatsApp no tiene (el telefono cumple ese rol). */
  handle?: string | null;
}

/**
 * Traduce "quien escribio" — un telefono, un PSID, un IGSID — al Contact del tenant.
 *
 * Antes esto era un `contact.upsert({ where: { tenantId_phone } })` desperdigado en el
 * webhook y en el envio saliente. Con Instagram y Messenger el telefono deja de servir
 * como identidad (no existe, y los ids de Meta son scoped por pagina), asi que la
 * resolucion vive aca y es el unico lugar que sabe como se identifica a alguien en
 * cada canal.
 */
@Injectable()
export class ContactIdentityService {
  private readonly logger = new Logger(ContactIdentityService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Devuelve el contacto detras de una identidad, creandolo si es la primera vez que
   * escribe. Idempotente y a prueba de mensajes simultaneos del mismo contacto.
   */
  async resolve(
    tenantId: string,
    channel: Channel,
    externalId: string,
    profile: IdentityProfile = {},
  ): Promise<Contact> {
    const existing = await this.prisma.contactIdentity.findUnique({
      where: { tenantId_channel_externalId: { tenantId, channel, externalId } },
      include: { contact: true },
    });

    if (existing) {
      // El nombre de perfil puede cambiar entre mensajes; el handle tambien (en
      // Instagram el usuario puede renombrarse). Solo se pisan si el canal los manda.
      const contactPatch = profile.name && profile.name !== existing.contact.name ? { name: profile.name } : null;
      const identityPatch = profile.handle && profile.handle !== existing.handle ? { handle: profile.handle } : null;

      if (identityPatch) {
        await this.prisma.contactIdentity.update({ where: { id: existing.id }, data: identityPatch });
      }
      if (contactPatch) {
        return this.prisma.contact.update({ where: { id: existing.contactId }, data: contactPatch });
      }
      return existing.contact;
    }

    return this.create(tenantId, channel, externalId, profile);
  }

  private async create(
    tenantId: string,
    channel: Channel,
    externalId: string,
    profile: IdentityProfile,
  ): Promise<Contact> {
    // En WhatsApp el contacto puede existir ya sin identidad: lo cargo un agente a mano
    // o entro por el import de CSV, que crea la ficha antes de que la persona escriba.
    // Enlazarlo en vez de crear uno nuevo es lo que evita la ficha duplicada.
    const byPhone =
      channel === 'WHATSAPP'
        ? await this.prisma.contact.findUnique({ where: { tenantId_phone: { tenantId, phone: externalId } } })
        : null;

    const contact =
      byPhone ??
      (await this.prisma.contact.create({
        data: {
          tenantId,
          name: profile.name ?? undefined,
          // Solo WhatsApp tiene telefono. Un PSID o un IGSID en esta columna seria
          // mentira: no es un numero y no se puede llamar ni exportar.
          phone: channel === 'WHATSAPP' ? externalId : null,
        },
      }));

    try {
      await this.prisma.contactIdentity.create({
        data: { tenantId, contactId: contact.id, channel, externalId, handle: profile.handle ?? null },
      });
    } catch (err: any) {
      // P2002 = otro mensaje del mismo contacto la creo entre el findUnique y este
      // create. No es un error: la identidad que queriamos ya existe.
      if (err?.code !== 'P2002') throw err;
      this.logger.debug(`Identidad ${channel}:${externalId} creada en paralelo, se reusa`);
      const raced = await this.prisma.contactIdentity.findUnique({
        where: { tenantId_channel_externalId: { tenantId, channel, externalId } },
        include: { contact: true },
      });
      if (raced) return raced.contact;
    }

    return contact;
  }

  /** La identidad de un contacto en un canal, si la tiene. Es el destinatario de un envio. */
  async findExternalId(contactId: string, channel: Channel): Promise<string | null> {
    const identity = await this.prisma.contactIdentity.findFirst({
      where: { contactId, channel },
      select: { externalId: true },
    });
    return identity?.externalId ?? null;
  }

  /** Alta de la identidad de WhatsApp de un contacto creado por fuera de un mensaje
   *  (alta manual, import de CSV). Silenciosa si ya la tiene. */
  async ensureWhatsAppIdentity(tenantId: string, contactId: string, phone: string) {
    try {
      await this.prisma.contactIdentity.create({
        data: { tenantId, contactId, channel: 'WHATSAPP', externalId: phone },
      });
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
    }
  }
}

/**
 * Como se llama este contacto en la bandeja.
 *
 * Un PSID es un entero de 16 digitos sin significado para nadie: mostrarlo es peor que
 * no mostrar nada, porque ocupa el lugar donde el agente espera reconocer a alguien.
 * Por eso el fallback nunca es el id pelado, sino el canal mas sus ultimos digitos,
 * que al menos distingue dos anonimos en la lista.
 */
export function displayId(
  channel: Channel | null | undefined,
  contact: { name?: string | null; phone?: string | null },
  identity?: { externalId?: string | null; handle?: string | null } | null,
): string {
  if (contact.name) return contact.name;

  switch (channel) {
    case 'INSTAGRAM':
      if (identity?.handle) return `@${identity.handle}`;
      return anonymous('Instagram', identity?.externalId);
    case 'MESSENGER':
      return anonymous('Messenger', identity?.externalId);
    // WhatsApp y las conversaciones sin canal resuelto: el telefono es el mejor
    // identificador que hay, y ademas es accionable (se copia, se llama).
    default:
      return contact.phone || identity?.externalId || 'Contacto';
  }
}

function anonymous(channelName: string, externalId?: string | null): string {
  const tail = externalId?.slice(-4);
  return tail ? `Contacto de ${channelName} · ${tail}` : `Contacto de ${channelName}`;
}

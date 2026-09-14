import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Cifrado simetrico para los secretos que se guardan en la base.
 *
 * Existe por una razon concreta: la configuracion de correo se carga desde el panel y
 * termina en SystemConfig, y una API key de correo en texto plano aparece en cualquier
 * `pg_dump` — con ella se pueden mandar correos firmados con el dominio del sistema.
 * Guardando el cifrado, una copia de la base no alcanza: hace falta tambien la clave,
 * que vive en el .env del servidor y no en la base.
 *
 * Formato: iv:authTag:ciphertext, los tres en hex. El authTag es lo que hace que un
 * valor manipulado falle al descifrar en vez de devolver basura silenciosamente.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    // Clave propia si existe; si no, se deriva del JWT_SECRET, que toda instalacion ya
    // tiene. Asi esto funciona en los despliegues actuales sin agregarles una variable,
    // y quien quiera separar los secretos puede definir ENCRYPTION_KEY.
    const secret = config.get<string>('ENCRYPTION_KEY') || config.get<string>('JWT_SECRET') || '';
    if (!secret) {
      this.logger.warn('Sin ENCRYPTION_KEY ni JWT_SECRET: los secretos guardados no se van a poder descifrar');
    }
    // scrypt con sal fija: la sal aleatoria obligaria a guardarla, y lo que protege acá
    // es que la clave no esta en la base, no la resistencia a un diccionario.
    this.key = scryptSync(secret, 'netservice-connect-secrets', 32);
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':');
  }

  /**
   * Devuelve null si el valor no se puede descifrar — pasa si cambio la clave del
   * servidor o si alguien edito la fila a mano. Null y no una excepcion porque quien
   * llama tiene que poder seguir (mostrar la pantalla de configuracion vacia) en vez de
   * que se caiga todo el arranque.
   */
  decrypt(payload: string): string | null {
    try {
      const [ivHex, tagHex, dataHex] = payload.split(':');
      if (!ivHex || !tagHex || !dataHex) return null;

      const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
    } catch {
      this.logger.warn('No se pudo descifrar un secreto guardado (¿cambió la clave del servidor?)');
      return null;
    }
  }
}

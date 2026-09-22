import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import axios from 'axios';
import { SystemConfigService } from '../system-config/system-config.service';

/**
 * Sube la imagen del encabezado de una plantilla y devuelve el "handle" que Meta
 * pide para poder aprobarla.
 *
 * Esto NO es el mismo camino que mandar una imagen en un mensaje. Son dos APIs
 * distintas y confundirlas es el error clasico de esta funcionalidad:
 *
 *  - ENVIAR una imagen usa `POST /{phoneNumberId}/media` con el token de la linea
 *    y devuelve un media id. Eso ya lo hace WhatsAppService.uploadMediaToMeta.
 *  - CREAR una plantilla con encabezado de imagen exige un handle de la Resumable
 *    Upload API, que es a nivel APLICACION (`/{appId}/uploads`) y usa un app access
 *    token. Un media id acá no sirve, y una URL publica tampoco: Meta responde
 *    INVALID_FORMAT sin aclarar cual de las dos cosas esperaba.
 *
 * La subida son dos llamadas: abrir la sesion y despues mandar los bytes.
 */
@Injectable()
export class MetaUploadService {
  private readonly logger = new Logger(MetaUploadService.name);

  constructor(private systemConfig: SystemConfigService) {}

  /**
   * Las credenciales de Meta salen de SystemConfigService, no del .env: se administran
   * desde Configuracion > Sistema y la base pisa al entorno. Leerlas de `process.env`
   * haria fallar la subida en cualquier instalacion que las tenga cargadas por el panel
   * — que es como estan puestas en los servers que ya corren.
   *
   * El app access token es literalmente "{appId}|{appSecret}", no hace falta pedirlo.
   */
  private async credentials() {
    const cfg = await this.systemConfig.get();
    if (!cfg.metaAppId || !cfg.metaAppSecret) {
      throw new BadRequestException(
        'Falta configurar el App ID y el App Secret de Meta (Configuración → Sistema) ' +
          'para poder subir imágenes de plantilla.',
      );
    }
    return {
      appId: cfg.metaAppId,
      token: `${cfg.metaAppId}|${cfg.metaAppSecret}`,
      apiVersion: cfg.metaApiVersion,
    };
  }

  async uploadHeaderImage(file: { buffer: Buffer; originalname: string; mimetype: string }): Promise<string> {
    const { appId, token, apiVersion } = await this.credentials();

    let sessionId: string;
    try {
      const { data } = await axios.post(`https://graph.facebook.com/${apiVersion}/${appId}/uploads`, null, {
        params: {
          file_name: file.originalname,
          file_length: file.buffer.length,
          file_type: file.mimetype,
          access_token: token,
        },
      });
      sessionId = data?.id;
    } catch (err) {
      this.logger.error('Falló al abrir la sesión de subida en Meta', err?.response?.data);
      throw new BadRequestException(
        err?.response?.data?.error?.message || 'No se pudo iniciar la subida de la imagen a Meta',
      );
    }

    if (!sessionId) {
      throw new BadRequestException('Meta no devolvió una sesión de subida para la imagen');
    }

    try {
      // El segundo paso usa "OAuth <token>", no "Bearer": con Bearer devuelve 400.
      const { data } = await axios.post(`https://graph.facebook.com/${apiVersion}/${sessionId}`, file.buffer, {
        headers: {
          Authorization: `OAuth ${token}`,
          file_offset: '0',
          'Content-Type': 'application/octet-stream',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      const handle = data?.h;
      if (!handle) throw new Error('respuesta sin handle');
      return handle;
    } catch (err) {
      this.logger.error('Falló al subir los bytes de la imagen a Meta', err?.response?.data);
      throw new BadRequestException(
        err?.response?.data?.error?.message || 'No se pudo subir la imagen de la plantilla a Meta',
      );
    }
  }
}

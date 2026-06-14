import { FastifyInstance } from 'fastify';
import { config } from '../config';
import { whatsAppService } from '../whatsapp/WhatsAppService';
import { conversationService } from '../conversations/ConversationService';
import { agentService } from '../agent/AgentService';
import { buildWhatsAppPayload, interactiveIdToText } from '../whatsapp/WhatsAppFormatter';

// ─── Tipos del payload webhook de Meta ───────────────────────────────────────

interface WaInteractiveReply {
  type: 'button_reply' | 'list_reply';
  button_reply?: { id: string; title: string };
  list_reply?:   { id: string; title: string; description?: string };
}

interface WaMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?:        { body: string };
  interactive?: WaInteractiveReply;
}

interface MetaWebhookBody {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        messages?: WaMessage[];
        statuses?: Array<{ id: string; status: string }>;
      };
    }>;
  }>;
}

/**
 * Extracts user-facing text from any supported inbound message type:
 *   - text          → body string
 *   - button_reply  → mapped via interactiveIdToText
 *   - list_reply    → mapped via interactiveIdToText
 * Returns null for unsupported types (stickers, images, etc.)
 */
function extractMessageText(msg: WaMessage): string | null {
  if (msg.type === 'text' && msg.text?.body) {
    return msg.text.body;
  }

  if (msg.type === 'interactive' && msg.interactive) {
    const reply = msg.interactive.button_reply ?? msg.interactive.list_reply;
    if (reply) {
      return interactiveIdToText(reply.id, reply.title);
    }
  }

  return null;
}

export async function webhookRoutes(app: FastifyInstance) {

  // ── GET /webhook/whatsapp — verificación de Meta ──────────────────────────
  // Meta llama este endpoint cuando configuras el webhook en el dashboard.
  // Responde con hub.challenge si el token coincide.
  app.get('/webhook/whatsapp', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const mode      = query['hub.mode'];
    const token     = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === config.WEBHOOK_VERIFY_TOKEN) {
      app.log.info('[Webhook] WhatsApp webhook verificado correctamente.');
      return reply.code(200).send(challenge);
    }

    app.log.warn({ token }, '[Webhook] Token de verificación inválido');
    return reply.code(403).send('Forbidden');
  });

  // ── POST /webhook/whatsapp — mensajes entrantes ───────────────────────────
  app.post('/webhook/whatsapp', async (req, reply) => {
    // Meta espera 200 inmediatamente — procesamos en background
    reply.code(200).send('EVENT_RECEIVED');

    const body = req.body as MetaWebhookBody;

    // Ignorar si no es WhatsApp
    if (body?.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;

        const value         = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;
        const messages      = value.messages ?? [];

        for (const msg of messages) {
          // Extraer texto del mensaje (texto plano o respuesta interactiva)
          const text = extractMessageText(msg);
          if (!text) continue; // sticker, imagen, audio, etc. → ignorar

          const from  = msg.from; // número del paciente e.g. "573001234567"
          const msgId = msg.id;

          app.log.info(`[Webhook] Mensaje de ${from} (${msg.type}): "${text}"`);

          try {
            // 1. Buscar tenant por phoneNumberId
            const tenantId = await whatsAppService.getTenantByPhoneNumberId(phoneNumberId);
            if (!tenantId) {
              app.log.warn(`[Webhook] phoneNumberId ${phoneNumberId} sin tenant configurado.`);
              continue;
            }

            // 2. Obtener config de WhatsApp del tenant
            const waCfg = await whatsAppService.getConfig(tenantId);
            if (!waCfg) continue;

            // 3. Buscar o crear conversación para este número
            const conv = await conversationService.findOrCreateWhatsApp(tenantId, from);

            // 4. Marcar mensaje como leído (best-effort)
            void whatsAppService.markAsRead(phoneNumberId, waCfg.accessToken, msgId);

            // 5. Procesar con el agente
            const response = await agentService.processMessage({
              conversationId: conv.conversationId,
              tenantId,
              channel:        'whatsapp',
              userMessage:    text,
              patientPhone:   from,
            });

            // 6. Construir payload con formato adecuado al estado de la conversación
            const payload = buildWhatsAppPayload(response.message, response.state);

            // 7. Enviar respuesta al paciente (con reintentos automáticos)
            await whatsAppService.sendPayload(
              phoneNumberId,
              waCfg.accessToken,
              from,
              payload,
            );

            app.log.info(
              `[Webhook] Respuesta enviada a ${from} (conv: ${conv.conversationId}, type: ${payload.type})`,
            );

          } catch (err) {
            app.log.error({
              msg:           '[Webhook] Error al procesar o enviar mensaje — reintentos agotados',
              from,
              phoneNumberId,
              error:         String(err),
            });

            // Último intento: mensaje genérico de error (sin reintentos para no buclear)
            try {
              const tenantId = await whatsAppService.getTenantByPhoneNumberId(phoneNumberId);
              const errCfg   = tenantId ? await whatsAppService.getConfig(tenantId) : null;
              if (errCfg) {
                await whatsAppService.sendMessage(
                  phoneNumberId,
                  errCfg.accessToken,
                  from,
                  'Lo siento, tuve un problema técnico. Por favor escribe de nuevo en un momento. 🙏',
                );
              }
            } catch { /* silencioso — ya logueamos el error principal */ }
          }
        }
      }
    }
  });
}

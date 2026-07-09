import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipeBuilder,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { WhatsAppService } from './whatsapp.service';
import { EmbeddedSignupService } from './embedded-signup.service';
import { WebhookService } from './webhook.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SendMessageDto } from './dto/send-message.dto';
import { SendMediaDto } from './dto/send-media.dto';
import { EmbeddedSignupDto, RegisterPhoneWithPinDto, ConnectDirectDto } from './dto/embedded-signup.dto';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB, generoso para imagen/audio/doc corto de WhatsApp

@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private waService: WhatsAppService,
    private signupService: EmbeddedSignupService,
    private webhookService: WebhookService,
    private systemConfig: SystemConfigService,
  ) {}

  // ─── Webhook Verification ──────────────────────────────────────────────────

  @Get('webhook')
  async verifyWebhook(@Query() query: any, @Res() res: Response) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    const cfg = await this.systemConfig.get();

    if (mode === 'subscribe' && token === cfg.metaVerifyToken) {
      this.logger.log('Webhook verificado por Meta');
      return res.status(200).send(challenge);
    }

    return res.status(403).send('Forbidden');
  }

  // ─── Webhook Events ───────────────────────────────────────────────────────
  // Meta espera un 200 inmediato — procesamos en background (fire & forget)

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  receiveWebhook(@Body() payload: any) {
    this.logger.debug('Webhook recibido de Meta');
    // No esperamos el procesamiento — devolvemos 200 de inmediato
    this.webhookService.processWebhookPayload(payload).catch((err) => {
      this.logger.error('Error procesando webhook', err);
    });
    return 'EVENT_RECEIVED';
  }

  // ─── Embedded Signup ──────────────────────────────────────────────────────
  // Recibe el `code` OAuth + session info del postMessage de Meta.
  // El backend hace el intercambio de código → token de larga duración.

  @UseGuards(JwtAuthGuard)
  @Post('embedded-signup')
  embeddedSignup(@CurrentUser() user: any, @Body() dto: EmbeddedSignupDto) {
    return this.signupService.processSignup(user.tenantId, dto);
  }

  // Registrar número con PIN de 2FA (si el signup lo requirió)
  @UseGuards(JwtAuthGuard)
  @Post('register-phone')
  registerPhone(@CurrentUser() user: any, @Body() dto: RegisterPhoneWithPinDto) {
    return this.signupService.registerPhoneWithPin(user.tenantId, dto.pin);
  }

  // Conexión manual con token temporal (API Setup de Meta — para desarrollo)
  @UseGuards(JwtAuthGuard)
  @Post('connect-direct')
  connectDirect(@CurrentUser() user: any, @Body() dto: ConnectDirectDto) {
    return this.signupService.connectDirect(
      user.tenantId,
      dto.accessToken,
      dto.phoneNumberId,
      dto.wabaId,  // opcional — si no se envía, se resuelve desde el token
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('account')
  getAccount(@CurrentUser() user: any) {
    return this.signupService.getAccount(user.tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('account')
  disconnect(@CurrentUser() user: any) {
    return this.signupService.disconnect(user.tenantId);
  }

  // ─── Send Message ──────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('send')
  sendMessage(@CurrentUser() user: any, @Body() dto: SendMessageDto) {
    return this.waService.sendMessage(user.tenantId, user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('send-media')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }))
  sendMedia(
    @CurrentUser() user: any,
    @Body() dto: SendMediaDto,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
  ) {
    return this.waService.sendMediaMessage(user.tenantId, user.id, dto, file);
  }
}

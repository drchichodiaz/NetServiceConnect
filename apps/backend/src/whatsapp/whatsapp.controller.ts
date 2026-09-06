import {
  Controller,
  Get,
  Post,
  Patch,
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
import { WhatsAppAccountsService } from './accounts.service';
import { WebhookService } from './webhook.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SendMessageDto } from './dto/send-message.dto';
import { SendMediaDto } from './dto/send-media.dto';
import { StartConversationDto } from './dto/start-conversation.dto';
import { EmbeddedSignupDto, RegisterPhoneWithPinDto, ConnectDirectDto } from './dto/embedded-signup.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB, generoso para imagen/audio/doc corto de WhatsApp

@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private waService: WhatsAppService,
    private signupService: EmbeddedSignupService,
    private webhookService: WebhookService,
    private accountsService: WhatsAppAccountsService,
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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  @Post('embedded-signup')
  embeddedSignup(@CurrentUser() user: any, @Body() dto: EmbeddedSignupDto) {
    return this.signupService.processSignup(user.tenantId, dto);
  }

  // Registrar número con PIN de 2FA (si el signup lo requirió)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  @Post('register-phone')
  registerPhone(@CurrentUser() user: any, @Body() dto: RegisterPhoneWithPinDto) {
    return this.signupService.registerPhoneWithPin(user.tenantId, dto.pin, dto.accountId);
  }

  // Conexión manual con token temporal (API Setup de Meta — para desarrollo)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  @Post('connect-direct')
  connectDirect(@CurrentUser() user: any, @Body() dto: ConnectDirectDto) {
    return this.signupService.connectDirect(
      user.tenantId,
      dto.accessToken,
      dto.phoneNumberId,
      dto.wabaId,  // opcional — si no se envía, se resuelve desde el token
    );
  }

  // ─── Líneas de WhatsApp (una por sucursal) ────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  @Get('accounts')
  listAccounts(@CurrentUser() user: any) {
    return this.accountsService.listForTenant(user.tenantId);
  }

  // Las lineas activas alimentan el filtro y el badge del inbox, asi que las puede
  // leer cualquier agente — solo nombre y numero, nunca el token.
  @UseGuards(JwtAuthGuard)
  @Get('accounts/active')
  listActiveAccounts(@CurrentUser() user: any) {
    return this.accountsService.listActiveForTenant(user.tenantId);
  }

  // Importa el resto de los numeros del WABA ya conectado, para no repetir el
  // signup una vez por sucursal.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  @Post('accounts/sync')
  syncAccounts(@CurrentUser() user: any) {
    return this.signupService.syncNumbers(user.tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  @Patch('accounts/:id')
  updateAccount(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accountsService.update(user.tenantId, id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  @Post('accounts/:id/default')
  setDefaultAccount(@CurrentUser() user: any, @Param('id') id: string) {
    return this.accountsService.setDefault(user.tenantId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  @Delete('accounts/:id')
  disconnectAccount(@CurrentUser() user: any, @Param('id') id: string) {
    return this.accountsService.disconnect(user.tenantId, id);
  }

  // ─── Send Message ──────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('send')
  sendMessage(@CurrentUser() user: any, @Body() dto: SendMessageDto) {
    return this.waService.sendMessage(user.tenantId, user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('start-conversation')
  startConversation(@CurrentUser() user: any, @Body() dto: StartConversationDto) {
    return this.waService.startConversation(user.tenantId, user.id, dto);
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

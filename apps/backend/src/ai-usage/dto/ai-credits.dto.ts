import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Los modelos que la plataforma puede usar. gpt-4-turbo quedo fuera a proposito:
 *  cuesta cuatro veces mas que gpt-4o y responde peor. */
export const PLATFORM_MODELS = ['gpt-4o-mini', 'gpt-4o'];

export class UpdatePlatformSettingsDto {
  /** Vacio la borra. Un valor que empieza con "sk-..." es el preview y se ignora. */
  @IsOptional() @IsString() @MaxLength(300)
  platformApiKey?: string;

  @IsOptional() @IsIn(PLATFORM_MODELS)
  platformModel?: string;

  @IsOptional() @IsNumber() @Min(0.001)
  markupFactor?: number;

  @IsOptional() @IsNumber() @Min(0.000001)
  creditUsdValue?: number;

  @IsOptional() @IsInt() @Min(0)
  minCreditsPerOp?: number;

  /** Con cuantos creditos nace una empresa nueva. 0 = ninguno. */
  @IsOptional() @IsInt() @Min(0)
  trialCredits?: number;
}

export class GrantCreditsDto {
  @IsInt() @Min(1)
  credits: number;

  @IsOptional() @IsIn(['MONTHLY_ALLOCATION', 'PURCHASE', 'BONUS', 'ADJUSTMENT'])
  kind?: 'MONTHLY_ALLOCATION' | 'PURCHASE' | 'BONUS' | 'ADJUSTMENT';

  /** Null o ausente = no vence. Lo incluido en un plan si deberia vencer. */
  @IsOptional() @IsString()
  expiresAt?: string | null;

  /** Contra que pago se acredita. Es lo que hace auditable una carga manual. */
  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

export class UpdateAiTenantDto {
  @IsOptional() @IsIn(['BYOK', 'PLATFORM'])
  billingMode?: 'BYOK' | 'PLATFORM';

  @IsOptional() @IsBoolean()
  aiEnabled?: boolean;
}

export class RequestTopUpDto {
  /** Cuantos creditos necesita. Opcional: puede pedir "una recarga" sin numero. */
  @IsOptional() @IsInt() @Min(1)
  credits?: number;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

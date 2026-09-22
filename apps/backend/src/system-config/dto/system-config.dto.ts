import { IsOptional, IsString } from 'class-validator';

export class UpdateSystemConfigDto {
  @IsOptional() @IsString() metaAppId?: string;
  @IsOptional() @IsString() metaConfigId?: string;
  @IsOptional() @IsString() metaAppSecret?: string;
  @IsOptional() @IsString() metaVerifyToken?: string;
  @IsOptional() @IsString() metaApiVersion?: string;
  @IsOptional() @IsString() mediaStoragePath?: string;
  /** A donde llegan los reportes de soporte. Vacio = la del entorno (SUPPORT_EMAIL). */
  @IsOptional() @IsString() supportEmail?: string;
}

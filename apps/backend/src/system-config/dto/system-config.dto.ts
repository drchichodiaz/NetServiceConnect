import { IsOptional, IsString } from 'class-validator';

export class UpdateSystemConfigDto {
  @IsOptional() @IsString() metaAppId?: string;
  @IsOptional() @IsString() metaConfigId?: string;
  @IsOptional() @IsString() metaAppSecret?: string;
  @IsOptional() @IsString() metaVerifyToken?: string;
  @IsOptional() @IsString() metaApiVersion?: string;
  @IsOptional() @IsString() mediaStoragePath?: string;
}

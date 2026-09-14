import { IsEmail, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateMailConfigDto {
  @IsOptional() @IsString() mailHost?: string;

  @IsOptional() @IsInt() @Min(1) @Max(65535) mailPort?: number;

  @IsOptional() @IsString() mailUser?: string;

  /** Vacio = dejar la que ya estaba. El panel nunca devuelve la actual. */
  @IsOptional() @IsString() mailPass?: string;

  @IsOptional() @IsString() mailFrom?: string;
}

export class SendTestMailDto {
  @IsEmail()
  to: string;
}

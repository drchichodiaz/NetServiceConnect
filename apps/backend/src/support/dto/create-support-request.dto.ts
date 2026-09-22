import { IsString, IsOptional, IsBoolean, IsInt, IsArray, ValidateNested, MinLength, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Un pedido al backend que le fallo al panel. Es lo que hace reproducible el reporte. */
export class FailedCallDto {
  @IsString() @MaxLength(10)
  method: string;

  @IsString() @MaxLength(300)
  url: string;

  @IsInt() @Min(0)
  status: number;

  /** El id que devolvio el backend en la respuesta: con el se busca en los logs. */
  @IsOptional() @IsString() @MaxLength(64)
  requestId?: string;

  /** El mensaje que devolvio el backend, ya recortado por el panel. */
  @IsOptional() @IsString() @MaxLength(500)
  message?: string;

  /** Cuando paso, en ISO. Lo pone el navegador, asi que puede estar corrido. */
  @IsOptional() @IsString() @MaxLength(40)
  at?: string;
}

/**
 * El navegador de quien reporta. Todo opcional: si mañana el panel deja de mandar
 * alguno, el reporte tiene que seguir entrando igual — un reporte incompleto sirve
 * mucho mas que uno que se rechaza por un campo que falta.
 */
export class ClientContextDto {
  /** Desde que pantalla se abrio el formulario. */
  @IsOptional() @IsString() @MaxLength(500)
  url?: string;

  @IsOptional() @IsString() @MaxLength(400)
  userAgent?: string;

  @IsOptional() @IsString() @MaxLength(40)
  viewport?: string;

  @IsOptional() @IsString() @MaxLength(60)
  language?: string;

  @IsOptional() @IsString() @MaxLength(60)
  timezone?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FailedCallDto)
  recentErrors?: FailedCallDto[];
}

export class CreateSupportRequestDto {
  /** "¿Que estabas haciendo?" */
  @IsString() @MinLength(3) @MaxLength(2000)
  activity: string;

  /** "¿Que paso?" */
  @IsString() @MinLength(3) @MaxLength(4000)
  problem: string;

  /** Si no puede seguir trabajando. Para priorizar sin leer todo. */
  @IsOptional() @IsBoolean()
  blocking?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ClientContextDto)
  context?: ClientContextDto;
}

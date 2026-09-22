import { IsOptional, IsString, IsInt, IsBoolean, MaxLength } from 'class-validator';

export class UpdateAccountDto {
  /** Nombre operativo de la linea, ej: "Sucursal Palermo". Vacio = volver a mostrar el numero. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  /** Bot que atiende la linea. null = el bot por defecto del tenant. */
  @IsOptional()
  @IsString()
  botId?: string | null;

  /** false = la linea no tiene bot: las conversaciones entran directo a los agentes. */
  @IsOptional()
  @IsBoolean()
  botEnabled?: boolean;
}

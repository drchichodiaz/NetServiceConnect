import { IsString, IsOptional, IsBoolean, IsEmail, MinLength, MaxLength } from 'class-validator';

export class CreatePartnerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  /**
   * Opcional y sin unique. Un vendedor puede no tener correo, y dos pueden compartir el
   * de la empresa para la que trabajan: exigirlo unico frenaria el alta de gente real
   * por una restriccion que no protege nada.
   */
  @IsOptional()
  @IsEmail({}, { message: 'El correo no parece válido' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  /** Cedula o RUC. Sin validar formato: entran extranjeros y empresas. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  agreement?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePartnerDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  /** Vacio borra el dato; por eso no lleva @IsEmail si viene como cadena vacia. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  agreement?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

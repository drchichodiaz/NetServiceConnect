import { IsString, IsOptional, IsBoolean, MinLength, MaxLength, Matches, IsDateString } from 'class-validator';

/**
 * Lo que se puede cambiar de una empresa ya creada. No hereda de CreateTenantDto a
 * proposito: ahi viven adminName/adminEmail/adminPassword, que son del alta del primer
 * usuario y no de la empresa — dejarlos entrar por aca daria a entender que editando la
 * empresa se le cambia la contrasena al administrador, que no es lo que pasa.
 */
export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  /**
   * Cambiarlo es legal pero no es gratis: es unico y es como se identifica a la empresa
   * en la operacion diaria. El panel avisa antes de tocarlo.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'El identificador va en minúsculas, números y guiones' })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  plan?: string;

  /**
   * El interruptor de corte. En false, nadie de esa empresa puede entrar (lo frena el
   * login) — es la alternativa a borrarla, que se lleva conversaciones, contactos,
   * plantillas y campañas para siempre.
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Quien vendio la cuenta. Cadena vacia = venta directa, o sea sacarle el partner. */
  @IsOptional()
  @IsString()
  partnerId?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha de venta no es válida' })
  soldAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  partnerNote?: string;
}

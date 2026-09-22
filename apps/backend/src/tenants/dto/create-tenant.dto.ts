import { IsString, MinLength, Matches, IsOptional, IsEmail, IsDateString } from 'class-validator';
import { IsStrongPassword } from '../../common/validators/is-strong-password.validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must be lowercase alphanumeric with hyphens' })
  slug: string;

  @IsOptional()
  @IsString()
  plan?: string;

  /**
   * Quien vendio la cuenta. Vacio = venta directa, que es como quedan todas las que no
   * pasaron por un partner.
   */
  @IsOptional()
  @IsString()
  partnerId?: string;

  /** Cuando se cerro la venta. Sin esto se toma el momento del alta. */
  @IsOptional()
  @IsDateString({}, { message: 'La fecha de venta no es válida' })
  soldAt?: string;

  /** Lo acordado para esta venta, si difiere del trato general del partner. */
  @IsOptional()
  @IsString()
  partnerNote?: string;

  @IsString()
  adminName: string;

  @IsEmail()
  adminEmail: string;

  @IsString()
  @IsStrongPassword()
  adminPassword: string;
}

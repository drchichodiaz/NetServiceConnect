import { IsString, IsOptional, IsIn, IsBoolean, IsEmail, IsArray } from 'class-validator';
import { IsStrongPassword } from '../../common/validators/is-strong-password.validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(['ADMIN', 'SUPERVISOR', 'AGENT'])
  role?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @IsStrongPassword()
  password?: string;

  /**
   * Lineas que puede ver. Lista vacia = sin restriccion (ve todas). Si no viene el
   * campo, las asignaciones actuales quedan como estan — distinto de mandar [].
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channelAccountIds?: string[];
}

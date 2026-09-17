import { IsEmail, IsString, IsOptional, IsIn } from 'class-validator';
import { IsStrongPassword } from '../../common/validators/is-strong-password.validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsStrongPassword()
  password: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsIn(['ADMIN', 'SUPERVISOR', 'AGENT'])
  role?: string;
}

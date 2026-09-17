import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  // A proposito NO lleva la regla de contrasena fuerte que si llevan los seis lugares
  // donde se FIJA una (ver is-strong-password.validator.ts): aca se valida una que ya
  // existe. Subir el minimo dejaria afuera a todos los que tienen una anterior a la
  // regla, que es justo lo que se decidio no hacer.
  @IsString()
  @MinLength(6)
  password: string;
}

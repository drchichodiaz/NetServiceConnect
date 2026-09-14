import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  /** La actual. Se pide aunque la sesion ya este iniciada: sin esto, cualquiera que
   *  encuentre la pantalla abierta le cambia la contrasena al dueno de la sesion. */
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(6)
  newPassword: string;
}

import { IsString } from 'class-validator';
import { IsStrongPassword } from '../../common/validators/is-strong-password.validator';

export class ChangePasswordDto {
  /** La actual. Se pide aunque la sesion ya este iniciada: sin esto, cualquiera que
   *  encuentre la pantalla abierta le cambia la contrasena al dueno de la sesion. */
  @IsString()
  currentPassword: string;

  @IsString()
  @IsStrongPassword()
  newPassword: string;
}

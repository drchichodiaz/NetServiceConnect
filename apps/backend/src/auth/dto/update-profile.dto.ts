import { IsOptional, IsString, MinLength } from 'class-validator';

/** Lo que un usuario puede cambiarse a si mismo. El email y el rol NO estan: cambiar
 *  el email es cambiar con que se entra, y el rol es una decision del administrador. */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;
}

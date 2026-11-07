import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Categorias que acepta Meta para `vertical`. Es una lista cerrada: cualquier otro
 * valor lo rechaza con un error generico de parametro invalido.
 */
export const BUSINESS_VERTICALS = [
  'UNDEFINED', 'OTHER', 'AUTO', 'BEAUTY', 'APPAREL', 'EDU', 'ENTERTAIN', 'EVENT_PLAN',
  'FINANCE', 'GROCERY', 'GOVT', 'HOTEL', 'HEALTH', 'NONPROFIT', 'PROF_SERVICES',
  'RETAIL', 'TRAVEL', 'RESTAURANT',
] as const;

/**
 * Lo que se puede cambiar del perfil de una linea. Los limites son los de Meta: si se
 * pasan, Meta responde con un error que no dice que campo fallo, asi que se validan aca.
 * El nombre visible NO esta: ese pasa por revision de Meta y se pide desde el
 * Administrador de WhatsApp.
 */
export class UpdateBusinessProfileDto {
  /** La frase corta que aparece bajo el nombre. Meta no acepta dejarla vacia. */
  @IsOptional()
  @IsString()
  @MaxLength(139)
  about?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  email?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  @Matches(/^https?:\/\/\S+$/i, { each: true, message: 'Cada sitio web tiene que empezar con http:// o https://' })
  websites?: string[];

  @IsOptional()
  @IsIn(BUSINESS_VERTICALS as unknown as string[])
  vertical?: string;
}

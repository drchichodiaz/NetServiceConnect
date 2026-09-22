import { IsString, IsOptional, IsArray, MinLength, MaxLength, Matches } from 'class-validator';

/** Paleta fija: elegir color no es el punto, distinguirlas de un vistazo si. */
const COLOR = /^#[0-9a-fA-F]{6}$/;

export class CreateContactTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name: string;

  @IsOptional()
  @IsString()
  @Matches(COLOR, { message: 'color debe ser un hex tipo #6366f1' })
  color?: string;
}

export class UpdateContactTagDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(COLOR, { message: 'color debe ser un hex tipo #6366f1' })
  color?: string;
}

/** Las etiquetas que quedan en un contacto. Es un reemplazo, no un agregado. */
export class SetContactTagsDto {
  @IsArray()
  @IsString({ each: true })
  tagIds: string[];
}

/**
 * Etiquetar o desetiquetar muchos contactos de una. Agregar y quitar viajan juntos
 * para poder hacer "sacale 'prospecto' y ponele 'cliente'" en un solo paso, que es
 * como se piensa al depurar una lista.
 */
export class BulkTagContactsDto {
  @IsArray()
  @IsString({ each: true })
  contactIds: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  addTagIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  removeTagIds?: string[];
}

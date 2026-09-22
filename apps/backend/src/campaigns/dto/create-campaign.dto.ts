import { IsString, IsOptional, IsIn, IsInt, Min, Max, IsArray, ValidateNested, MinLength } from 'class-validator';
import { Type, Transform, plainToInstance } from 'class-transformer';

/**
 * Un mapeo mal formado tiene que dar un error de validacion, no romper el request.
 * Se devuelve el string original a proposito: asi falla el @IsArray con "mapping must
 * be an array". Devolver undefined lo haria pasar como "sin mapeo" y el error final
 * seria "falta indicar de donde sale la variable {{1}}", que apunta al lugar equivocado.
 */
function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * De donde sale el valor de UNA variable de la plantilla.
 *
 * `target` + `index` identifican el hueco (el {{1}} del encabezado, el {{2}} del
 * cuerpo, el enlace del boton 0). El valor sale de una columna del Excel o es el
 * mismo para todos.
 */
export class VariableMappingDto {
  @IsIn(['header', 'body', 'button'])
  target: 'header' | 'body' | 'button';

  @IsInt()
  @Min(0)
  @Type(() => Number)
  index: number;

  /** Encabezado de la columna del archivo. `__name__` es el nombre del contacto. */
  @IsOptional()
  @IsString()
  column?: string;

  /** Alternativa a `column`: el mismo texto para todos los destinatarios. */
  @IsOptional()
  @IsString()
  fixedValue?: string;
}

export class CreateCampaignDto {
  @IsString()
  @MinLength(1)
  name: string;

  /**
   * De donde salen los destinatarios.
   *  - FILE: un Excel/CSV subido, con una columna por variable (permite datos por persona).
   *  - CONTACTS: los contactos que ya estan en el sistema, filtrados o elegidos a mano.
   * Por defecto FILE, que era el unico modo cuando esto se construyo.
   */
  @IsOptional()
  @IsIn(['FILE', 'CONTACTS'])
  source?: 'FILE' | 'CONTACTS';

  /** Solo con source CONTACTS: los elegidos a mano. Si viene, pisa a contactSearch. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (typeof value === 'string' ? safeParse(value) : value), { toClassOnly: true })
  contactIds?: string[];

  /**
   * Solo con source CONTACTS: el mismo texto de busqueda de la lista de contactos.
   * Vacio y sin contactIds ni etiquetas = todos los contactos con WhatsApp del tenant.
   */
  @IsOptional()
  @IsString()
  contactSearch?: string;

  /**
   * Solo con source CONTACTS: las etiquetas que tiene que tener el contacto para
   * entrar. Se combina con contactSearch (las dos condiciones a la vez).
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (typeof value === 'string' ? safeParse(value) : value), { toClassOnly: true })
  tagIds?: string[];

  /**
   * Etiquetas que dejan a alguien AFUERA aunque cumpla el resto del filtro. Es lo que
   * permite "todos los mayoristas menos los que ya compraron" sin armar el Excel a
   * mano. Gana sobre tagIds: si un contacto tiene las dos, no recibe.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (typeof value === 'string' ? safeParse(value) : value), { toClassOnly: true })
  excludeTagIds?: string[];

  /** ALL = tiene que tener todas las de tagIds; ANY (default) = alguna alcanza. */
  @IsOptional()
  @IsIn(['ANY', 'ALL'])
  tagMatch?: 'ANY' | 'ALL';

  @IsString()
  templateId: string;

  @IsString()
  channelAccountId: string;

  /**
   * Destinatarios por minuto. El tope real no es la velocidad de la API sino el
   * limite diario de destinatarios unicos que Meta le pone a cada numero, que en un
   * numero nuevo es bajo. Ir despacio tambien protege la calificacion de calidad.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  @Type(() => Number)
  ratePerMinute?: number;

  /**
   * Viaja dentro de un multipart junto al archivo, asi que llega como string JSON.
   *
   * Se instancia el DTO a mano con plainToInstance en vez de usar @Type: cuando hay un
   * @Transform en la misma propiedad, @Type no se aplica, los elementos quedan como
   * objetos planos y `forbidNonWhitelisted` los rechaza campo por campo con un
   * "property target should not exist" que no dice nada del problema real.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Transform(
    ({ value }) => {
      const raw = typeof value === 'string' ? safeParse(value) : value;
      return Array.isArray(raw) ? plainToInstance(VariableMappingDto, raw) : raw;
    },
    { toClassOnly: true },
  )
  mapping?: VariableMappingDto[];
}

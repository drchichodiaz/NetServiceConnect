import {
  IsString,
  IsIn,
  IsOptional,
  IsArray,
  MinLength,
  Matches,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TemplateButtonDto {
  @IsIn(['QUICK_REPLY', 'URL', 'PHONE_NUMBER'])
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';

  @IsString()
  @MinLength(1)
  text: string;

  // Solo para type URL. Puede terminar en {{1}} para una parte variable.
  @IsOptional()
  @IsString()
  url?: string;

  // Valor de ejemplo del {{1}} de la URL — Meta lo exige para aprobar la plantilla.
  @IsOptional()
  @IsString()
  urlExample?: string;

  // Solo para type PHONE_NUMBER.
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

export class CreateTemplateDto {
  @IsString()
  @Matches(/^[a-z0-9_]+$/, { message: 'name debe ser minusculas, numeros y guion bajo unicamente' })
  name: string;

  @IsString()
  language: string;

  // WABA donde crear la plantilla. Opcional: sin esto va al WABA de la linea por
  // defecto, que es el unico caso posible cuando el tenant tiene una sola cuenta.
  @IsOptional()
  @IsString()
  wabaId?: string;

  @IsIn(['MARKETING', 'UTILITY', 'AUTHENTICATION'])
  category: string;

  // ── Encabezado (opcional) ───────────────────────────────────────────────────

  @IsOptional()
  @IsIn(['TEXT', 'IMAGE'])
  headerFormat?: 'TEXT' | 'IMAGE';

  @IsOptional()
  @IsString()
  headerText?: string;

  // Un unico valor, para el {{1}} del encabezado de texto.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1)
  headerExampleValues?: string[];

  // Los tres salen de POST /whatsapp/templates/header-media, que sube la imagen a
  // Meta y guarda una copia nuestra. El handle es lo que Meta pide para aprobarla;
  // path y mime son para la vista previa y para poder re-subirla cuando el media id
  // de una linea vence.
  @IsOptional()
  @IsString()
  headerMediaHandle?: string;

  @IsOptional()
  @IsString()
  headerMediaPath?: string;

  @IsOptional()
  @IsString()
  headerMediaMime?: string;

  // ── Cuerpo ──────────────────────────────────────────────────────────────────

  @IsString()
  @MinLength(1)
  bodyText: string;

  // Un valor de ejemplo por cada {{n}} en bodyText — Meta lo exige para aprobar
  // la plantilla, si no la rechaza con motivo INVALID_FORMAT.
  @IsOptional()
  @IsArray()
  exampleValues?: string[];

  // ── Pie y botones (opcionales) ──────────────────────────────────────────────

  @IsOptional()
  @IsString()
  footerText?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateButtonDto)
  buttons?: TemplateButtonDto[];
}

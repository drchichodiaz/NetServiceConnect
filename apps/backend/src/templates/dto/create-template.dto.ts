import { IsString, IsIn, IsOptional, IsArray, MinLength, Matches } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @Matches(/^[a-z0-9_]+$/, { message: 'name debe ser minusculas, numeros y guion bajo unicamente' })
  name: string;

  @IsString()
  language: string;

  @IsIn(['MARKETING', 'UTILITY', 'AUTHENTICATION'])
  category: string;

  @IsString()
  @MinLength(1)
  bodyText: string;

  // Un valor de ejemplo por cada {{n}} en bodyText — Meta lo exige para aprobar
  // la plantilla, si no la rechaza con motivo INVALID_FORMAT.
  @IsOptional()
  @IsArray()
  exampleValues?: string[];
}

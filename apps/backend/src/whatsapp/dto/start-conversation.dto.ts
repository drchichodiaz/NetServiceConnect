import { IsString, IsOptional, IsArray, ValidateNested, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ButtonVariableDto {
  // Posicion del boton en la plantilla (0-based), que es el `index` que espera Meta.
  @IsInt()
  @Min(0)
  index: number;

  @IsString()
  value: string;
}

export class StartConversationDto {
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  templateId: string;

  // Linea por la que se inicia la conversacion. Opcional: si no viene, se usa la
  // linea por defecto del tenant (el caso de un tenant con un solo numero).
  @IsOptional()
  @IsString()
  channelAccountId?: string;

  // Valores de las {{n}} del cuerpo, en orden.
  @IsOptional()
  @IsArray()
  variables?: string[];

  // Valor del {{1}} del encabezado, si la plantilla tiene encabezado de texto con variable.
  @IsOptional()
  @IsArray()
  headerVariables?: string[];

  // Valor del {{1}} de cada boton de enlace con URL dinamica.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ButtonVariableDto)
  buttonVariables?: ButtonVariableDto[];
}

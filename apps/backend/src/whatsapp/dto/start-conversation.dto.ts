import { IsString, IsOptional, IsArray } from 'class-validator';

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
  whatsappAccountId?: string;

  @IsOptional()
  @IsArray()
  variables?: string[];
}

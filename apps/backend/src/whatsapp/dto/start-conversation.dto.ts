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

  @IsOptional()
  @IsArray()
  variables?: string[];
}

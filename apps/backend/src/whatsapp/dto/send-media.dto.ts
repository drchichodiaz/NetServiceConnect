import { IsString, IsOptional, IsIn } from 'class-validator';

export class SendMediaDto {
  @IsString()
  conversationId: string;

  @IsString()
  to: string;

  @IsIn(['image', 'audio', 'document', 'video'])
  type: string;

  @IsOptional()
  @IsString()
  caption?: string;
}

import { IsString, IsOptional, IsIn } from 'class-validator';

export class SendMessageDto {
  @IsString()
  conversationId: string;


  @IsIn(['text', 'image', 'audio', 'document'])
  type: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  mediaType?: string;
}

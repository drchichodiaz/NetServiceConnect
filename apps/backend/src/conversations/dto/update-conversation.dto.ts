import { IsOptional, IsIn, IsString, IsArray } from 'class-validator';

export class UpdateConversationDto {
  @IsOptional()
  @IsIn(['OPEN', 'PENDING', 'CLOSED'])
  status?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];
}

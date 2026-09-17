import { IsOptional, IsIn, IsString } from 'class-validator';

export class UpdateConversationDto {
  @IsOptional()
  @IsIn(['OPEN', 'PENDING', 'CLOSED'])
  status?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;
}

import { IsOptional, IsString, MinLength } from 'class-validator';

export class ChatRequestDto {
  @IsString()
  @MinLength(1)
  query: string;

  @IsOptional()
  @IsString()
  conversationId?: string;
}

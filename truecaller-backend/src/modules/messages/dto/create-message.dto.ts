import { IsNotEmpty, IsOptional, IsString, IsEnum, IsBoolean } from 'class-validator';
import { MessageCategory } from '@prisma/client';

export class CreateMessageDto {
  @IsString()
  @IsNotEmpty()
  sender: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsEnum(MessageCategory)
  category?: MessageCategory;
}

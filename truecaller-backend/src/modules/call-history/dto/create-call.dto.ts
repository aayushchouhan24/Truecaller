import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min } from 'class-validator';
import { CallType } from '@prisma/client';

export class CreateCallDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[1-9]\d{6,14}$/)
  phoneNumber: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsEnum(CallType)
  type: CallType;

  @IsOptional()
  @IsInt()
  @Min(0)
  duration?: number;

  @IsOptional()
  @IsInt()
  sim?: number;
}

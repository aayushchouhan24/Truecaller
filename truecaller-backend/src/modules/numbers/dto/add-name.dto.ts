import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  Matches,
  Min,
  Max,
} from 'class-validator';
import { SourceType } from '@prisma/client';

export class AddNameDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[1-9]\d{6,14}$/, {
    message: 'phoneNumber must be a valid phone number',
  })
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(SourceType)
  @IsOptional()
  sourceType?: SourceType;

  @IsNumber()
  @IsOptional()
  @Min(0.1)
  @Max(5.0)
  weight?: number;
}

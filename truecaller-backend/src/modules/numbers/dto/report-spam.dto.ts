import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class ReportSpamDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[1-9]\d{6,14}$/, {
    message: 'phoneNumber must be a valid phone number',
  })
  phoneNumber: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

import { IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[1-9]\d{6,14}$/, {
    message: 'phoneNumber must be a valid phone number (e.g., +919900000001)',
  })
  phoneNumber: string;

  @IsString()
  @IsOptional()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  name?: string;
}

export class FirebaseLoginDto {
  @IsString()
  @IsNotEmpty({ message: 'Firebase token is required' })
  firebaseToken: string;

  @IsString()
  @IsOptional()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  name?: string;
}

import { IsArray, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ContactDto {
  @IsString()
  phoneNumber: string;

  @IsString()
  name: string;
}

export class SyncContactsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts: ContactDto[];
}

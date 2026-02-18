import { IsArray, IsString, ValidateNested, ArrayMaxSize, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

class ContactDto {
  @IsString()
  phoneNumber: string;

  @IsString()
  name: string;
}

export class SyncContactsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000) // prevent abuse — max 5 000 contacts per sync
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts: ContactDto[];
}

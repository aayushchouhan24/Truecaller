import { Controller, Post, Body, Get, Delete } from '@nestjs/common';
import { NumbersService } from './numbers.service';
import { LookupDto } from './dto/lookup.dto';
import { ReportSpamDto } from './dto/report-spam.dto';
import { AddNameDto } from './dto/add-name.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('numbers')
export class NumbersController {
  constructor(private readonly numbersService: NumbersService) {}

  @Post('lookup')
  async lookup(
    @CurrentUser('id') userId: string,
    @Body() lookupDto: LookupDto,
  ) {
    return this.numbersService.lookup(lookupDto, userId);
  }

  @Post('report-spam')
  async reportSpam(
    @CurrentUser('id') userId: string,
    @Body() reportSpamDto: ReportSpamDto,
  ) {
    return this.numbersService.reportSpam(userId, reportSpamDto);
  }

  @Post('remove-spam')
  async removeSpam(
    @CurrentUser('id') userId: string,
    @Body('phoneNumber') phoneNumber: string,
  ) {
    return this.numbersService.removeSpamReport(userId, phoneNumber);
  }

  @Post('add-name')
  async addName(
    @CurrentUser('id') userId: string,
    @Body() addNameDto: AddNameDto,
  ) {
    return this.numbersService.addName(userId, addNameDto);
  }

  @Post('backfill-names')
  async backfillNames() {
    const resolved = await this.numbersService.backfillUnresolvedNames();
    return {
      success: true,
      message: `Resolved ${resolved} names from user contacts`,
      resolved,
    };
  }
}

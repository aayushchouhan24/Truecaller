import { Controller, Get, Post, Delete, Body, Param, Query, Request } from '@nestjs/common';
import { CallHistoryService } from './call-history.service';
import { CreateCallDto } from './dto/create-call.dto';
import { CallType } from '@prisma/client';

@Controller('call-history')
export class CallHistoryController {
  constructor(private readonly callHistoryService: CallHistoryService) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreateCallDto) {
    return this.callHistoryService.create(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req: any, @Query('type') type?: string) {
    const callType = type ? (type.toUpperCase() as CallType) : undefined;
    return this.callHistoryService.findAll(req.user.id, callType);
  }

  @Get('recent-contacts')
  getRecentContacts(@Request() req: any) {
    return this.callHistoryService.getRecentContacts(req.user.id);
  }

  @Delete(':id')
  deleteOne(@Request() req: any, @Param('id') id: string) {
    return this.callHistoryService.deleteOne(req.user.id, id);
  }

  @Delete()
  deleteAll(@Request() req: any) {
    return this.callHistoryService.deleteAll(req.user.id);
  }
}

import { Controller, Get, Post, Delete, Body, Request } from '@nestjs/common';
import { SearchHistoryService } from './search-history.service';

@Controller('search-history')
export class SearchHistoryController {
  constructor(private readonly searchHistoryService: SearchHistoryService) {}

  @Post()
  create(@Request() req: any, @Body() body: { query: string; phoneNumber?: string; resultName?: string }) {
    return this.searchHistoryService.create(req.user.id, body.query, body.phoneNumber, body.resultName);
  }

  @Get()
  findAll(@Request() req: any) {
    return this.searchHistoryService.findAll(req.user.id);
  }

  @Delete()
  clear(@Request() req: any) {
    return this.searchHistoryService.clear(req.user.id);
  }
}

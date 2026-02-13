import { Controller, Get, Post, Delete, Patch, Body, Param, Query, Request } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { MessageCategory } from '@prisma/client';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreateMessageDto) {
    return this.messagesService.create(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req: any, @Query('category') category?: string) {
    const cat = category ? (category.toUpperCase() as MessageCategory) : undefined;
    return this.messagesService.findAll(req.user.id, cat);
  }

  @Get('unread-count')
  getUnreadCount(@Request() req: any) {
    return this.messagesService.getUnreadCount(req.user.id);
  }

  @Patch(':id/read')
  markRead(@Request() req: any, @Param('id') id: string) {
    return this.messagesService.markRead(req.user.id, id);
  }

  @Patch('read-all')
  markAllRead(@Request() req: any) {
    return this.messagesService.markAllRead(req.user.id);
  }

  @Delete(':id')
  delete(@Request() req: any, @Param('id') id: string) {
    return this.messagesService.delete(req.user.id, id);
  }
}

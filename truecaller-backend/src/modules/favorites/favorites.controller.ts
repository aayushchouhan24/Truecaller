import { Controller, Get, Post, Delete, Body, Request } from '@nestjs/common';
import { FavoritesService } from './favorites.service';

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post()
  add(@Request() req: any, @Body() body: { phoneNumber: string; name: string }) {
    return this.favoritesService.add(req.user.id, body.phoneNumber, body.name);
  }

  @Get()
  findAll(@Request() req: any) {
    return this.favoritesService.findAll(req.user.id);
  }

  @Delete()
  remove(@Request() req: any, @Body() body: { phoneNumber: string }) {
    return this.favoritesService.remove(req.user.id, body.phoneNumber);
  }
}

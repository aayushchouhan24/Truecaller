import { Controller, Get, Post, Delete, Body, UseGuards } from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  async getAll(@CurrentUser('id') userId: string) {
    return this.favoritesService.getAll(userId);
  }

  @Post()
  async add(
    @CurrentUser('id') userId: string,
    @Body() body: { phoneNumber: string; name: string },
  ) {
    return this.favoritesService.add(userId, body.phoneNumber, body.name);
  }

  @Delete()
  async remove(
    @CurrentUser('id') userId: string,
    @Body() body: { phoneNumber: string },
  ) {
    return this.favoritesService.remove(userId, body.phoneNumber);
  }
}

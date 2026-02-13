import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getProfile(@CurrentUser('id') userId: string) {
    return this.usersService.findById(userId);
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body('name') name: string,
  ) {
    return this.usersService.updateName(userId, name);
  }

  /** Record a profile view when user A views user B's profile */
  @Post('profile-view/:viewedId')
  async recordProfileView(
    @CurrentUser('id') viewerId: string,
    @Param('viewedId') viewedId: string,
  ) {
    return this.usersService.recordProfileView(viewerId, viewedId);
  }

  /** Record a profile view by phone number (lookup) */
  @Post('profile-view-by-phone')
  async recordProfileViewByPhone(
    @CurrentUser('id') viewerId: string,
    @Body('phoneNumber') phoneNumber: string,
  ) {
    return this.usersService.recordProfileViewByPhone(viewerId, phoneNumber);
  }

  /** Get who viewed my profile */
  @Get('who-viewed-me')
  async whoViewedMe(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
  ) {
    return this.usersService.getWhoViewedMe(userId, parseInt(page || '1'));
  }

  /** Get who searched for me */
  @Get('who-searched-me')
  async whoSearchedMe(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
  ) {
    return this.usersService.getWhoSearchedMe(userId, parseInt(page || '1'));
  }

  /** Get my stats */
  @Get('stats')
  async getStats(@CurrentUser('id') userId: string) {
    return this.usersService.getUserStats(userId);
  }
}

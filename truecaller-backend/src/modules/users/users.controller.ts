import { Controller, Get, Patch, Body } from '@nestjs/common';
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

  @Get('stats')
  async getStats(@CurrentUser('id') userId: string) {
    return this.usersService.getUserStats(userId);
  }
}

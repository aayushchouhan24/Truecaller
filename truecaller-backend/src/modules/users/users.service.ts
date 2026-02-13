import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByPhoneNumber(phoneNumber: string) {
    return this.prisma.user.findUnique({ where: { phoneNumber } });
  }

  async updateName(id: string, name: string) {
    return this.prisma.user.update({
      where: { id },
      data: { name },
    });
  }

  /** Record that viewerId viewed viewedId's profile */
  async recordProfileView(viewerId: string, viewedId: string) {
    if (viewerId === viewedId) {
      return { message: 'Cannot view own profile' };
    }

    // Prevent duplicate views within 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.prisma.profileView.findFirst({
      where: {
        viewerId,
        viewedId,
        createdAt: { gte: oneHourAgo },
      },
    });

    if (recent) {
      return { message: 'Already recorded recently', id: recent.id };
    }

    const view = await this.prisma.profileView.create({
      data: { viewerId, viewedId },
    });

    this.logger.log(`Profile view: ${viewerId} -> ${viewedId}`);
    return { message: 'Profile view recorded', id: view.id };
  }

  /** Record a view by phone number — find user by phone, then record */
  async recordProfileViewByPhone(viewerId: string, phoneNumber: string) {
    const viewedUser = await this.prisma.user.findUnique({
      where: { phoneNumber },
    });

    if (!viewedUser) {
      // User doesn't exist in our system — can't track
      return { message: 'User not found', tracked: false };
    }

    if (viewedUser.id === viewerId) {
      return { message: 'Cannot view own profile', tracked: false };
    }

    const result = await this.recordProfileView(viewerId, viewedUser.id);
    return { ...result, tracked: true };
  }

  /** Get list of users who viewed my profile */
  async getWhoViewedMe(userId: string, page = 1) {
    const pageSize = 20;
    const skip = (page - 1) * pageSize;

    const [views, total] = await Promise.all([
      this.prisma.profileView.findMany({
        where: { viewedId: userId },
        include: {
          viewer: {
            select: { id: true, phoneNumber: true, name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip,
      }),
      this.prisma.profileView.count({
        where: { viewedId: userId },
      }),
    ]);

    return {
      data: views.map((v: any) => ({
        id: v.id,
        viewerId: v.viewerId,
        viewerName: v.viewer.name,
        viewerPhone: v.viewer.phoneNumber,
        viewedAt: v.createdAt,
      })),
      total,
      page,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /** Get who searched for me (by phone number in search history) */
  async getWhoSearchedMe(userId: string, page = 1) {
    const pageSize = 20;
    const skip = (page - 1) * pageSize;

    // Find the current user's phone number
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const [searches, total] = await Promise.all([
      this.prisma.searchHistory.findMany({
        where: {
          phoneNumber: user.phoneNumber,
          NOT: { userId: userId }, // Exclude self-searches
        },
        include: {
          user: {
            select: { id: true, phoneNumber: true, name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip,
      }),
      this.prisma.searchHistory.count({
        where: {
          phoneNumber: user.phoneNumber,
          NOT: { userId: userId },
        },
      }),
    ]);

    return {
      data: searches.map((s: any) => ({
        id: s.id,
        searcherId: s.userId,
        searcherName: s.user.name,
        searcherPhone: s.user.phoneNumber,
        searchedAt: s.createdAt,
      })),
      total,
      page,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /** Get user stats */
  async getUserStats(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const [profileViewsCount, searchedByCount, spamReportsCount, searchesMadeCount] = await Promise.all([
      this.prisma.profileView.count({ where: { viewedId: userId } }),
      this.prisma.searchHistory.count({
        where: { phoneNumber: user.phoneNumber, NOT: { userId } },
      }),
      this.prisma.spamReport.count({ where: { reporterId: userId } }),
      this.prisma.searchHistory.count({ where: { userId } }),
    ]);

    return {
      profileViews: profileViewsCount,
      searchedBy: searchedByCount,
      spamReported: spamReportsCount,
      searchesMade: searchesMadeCount,
    };
  }
}

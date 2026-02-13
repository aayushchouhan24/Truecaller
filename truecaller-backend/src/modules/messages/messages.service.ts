import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SpamService } from '../spam/spam.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { MessageCategory } from '@prisma/client';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private spamService: SpamService,
  ) {}

  async create(userId: string, dto: CreateMessageDto) {
    // Auto-detect spam
    const isSpam = this.detectSpam(dto.body, dto.sender);
    const category = dto.category || this.classifyMessage(dto.body, dto.sender);

    return this.prisma.message.create({
      data: {
        userId,
        sender: dto.sender,
        body: dto.body,
        category,
        isSpam,
      },
    });
  }

  async findAll(userId: string, category?: MessageCategory) {
    const where: any = { userId };
    if (category) where.category = category;

    return this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markRead(userId: string, id: string) {
    return this.prisma.message.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.message.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async getUnreadCount(userId: string) {
    return this.prisma.message.count({
      where: { userId, isRead: false },
    });
  }

  async delete(userId: string, id: string) {
    return this.prisma.message.deleteMany({
      where: { id, userId },
    });
  }

  // ── Classification Helpers ──

  private classifyMessage(body: string, sender: string): MessageCategory {
    const lower = body.toLowerCase();
    const senderLower = sender.toLowerCase();

    // OTP detection
    if (/\b(otp|verification code|verify|one.?time)\b/i.test(lower)) return MessageCategory.OTP;

    // Transactional: bank, payment, order
    if (/\b(debited|credited|a\/c|balance|order|shipped|delivered|payment|receipt)\b/i.test(lower)) return MessageCategory.TRANSACTIONAL;

    // Promotional: offers, discounts
    if (/\b(offer|discount|sale|cashback|off|deal|free|limited|hurry|shop now|click)\b/i.test(lower)) return MessageCategory.PROMOTIONAL;

    // Spam detection
    if (this.detectSpam(body, sender)) return MessageCategory.SPAM;

    // Named senders (brands) are usually transactional/promotional
    if (/^[A-Z]{2,}-/.test(sender) || /^[A-Z][a-z]+$/.test(sender)) return MessageCategory.TRANSACTIONAL;

    return MessageCategory.PERSONAL;
  }

  private detectSpam(body: string, sender: string): boolean {
    const spamPatterns = [
      /won\s+rs/i, /click\s+here/i, /claim\s+your/i,
      /prize/i, /lottery/i, /congratulations.*won/i,
      /kyc.*expir/i, /suspend.*account/i, /urgent.*update/i,
    ];
    return spamPatterns.some(p => p.test(body));
  }
}

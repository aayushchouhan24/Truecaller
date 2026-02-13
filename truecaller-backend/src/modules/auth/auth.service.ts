import { Injectable, Inject, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma.service';
import { LoginDto, FirebaseLoginDto } from './dto/login.dto';
import * as admin from 'firebase-admin';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Inject('FIREBASE_ADMIN') private readonly firebaseAdmin: typeof admin,
  ) {}

  async login(loginDto: LoginDto) {
    const { phoneNumber, name } = loginDto;

    // Check if user exists
    let user = await this.prisma.user.findUnique({
      where: { phoneNumber },
    });

    if (!user) {
      // New user — name is mandatory for account creation
      if (!name || name.trim().length < 2) {
        return { needsName: true, message: 'Name is required for new accounts' };
      }
      user = await this.prisma.user.create({
        data: { phoneNumber, name: name.trim() },
      });
      this.logger.log(`New user created: ${phoneNumber} (${name})`);
    } else if (name && name.trim().length >= 2) {
      // Existing user — only update name if explicitly provided
      user = await this.prisma.user.update({
        where: { phoneNumber },
        data: { name: name.trim() },
      });
      this.logger.log(`User ${phoneNumber} logged in, name updated to: ${name}`);
    } else {
      this.logger.log(`User ${phoneNumber} logged in`);
    }

    // Generate JWT
    const payload = { sub: user.id, phoneNumber: user.phoneNumber };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        phoneNumber: user.phoneNumber,
        name: user.name,
      },
    };
  }

  /** Firebase OTP login — verify Firebase ID token and extract phone */
  async firebaseLogin(dto: FirebaseLoginDto) {
    const { firebaseToken, name } = dto;

    // Verify the Firebase ID token
    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await this.firebaseAdmin.auth().verifyIdToken(firebaseToken);
    } catch (error: any) {
      this.logger.warn(`Firebase token verification failed: ${error.message}`);
      throw new UnauthorizedException('Invalid or expired Firebase token');
    }

    // Extract phone number from Firebase token
    const phoneNumber = decodedToken.phone_number;
    if (!phoneNumber) {
      throw new UnauthorizedException('No phone number found in Firebase token');
    }

    // Check if user exists
    let user = await this.prisma.user.findUnique({
      where: { phoneNumber },
    });

    if (!user) {
      // New user — name is mandatory for account creation
      if (!name || name.trim().length < 2) {
        return { needsName: true, message: 'Name is required for new accounts' };
      }
      user = await this.prisma.user.create({
        data: { phoneNumber, name: name.trim() },
      });
      this.logger.log(`New user created via Firebase: ${phoneNumber} (${name})`);
    } else if (name && name.trim().length >= 2) {
      user = await this.prisma.user.update({
        where: { phoneNumber },
        data: { name: name.trim() },
      });
      this.logger.log(`User ${phoneNumber} logged in via Firebase, name updated to: ${name}`);
    } else {
      this.logger.log(`User ${phoneNumber} logged in via Firebase`);
    }

    // Generate our own JWT
    const payload = { sub: user.id, phoneNumber: user.phoneNumber };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        phoneNumber: user.phoneNumber,
        name: user.name,
      },
    };
  }

  async validateUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
    });
  }
}

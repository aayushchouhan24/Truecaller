import { Injectable, Inject, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { LoginDto, FirebaseLoginDto } from './dto/login.dto';
import * as admin from 'firebase-admin';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly identityService: IdentityService,
    @Inject('FIREBASE_ADMIN') private readonly firebaseAdmin: typeof admin,
  ) {}

  async login(loginDto: LoginDto) {
    const { phoneNumber, name } = loginDto;

    let user = await this.prisma.user.findUnique({
      where: { phoneNumber },
    });

    if (!user) {
      if (!name || name.trim().length < 2) {
        return { needsName: true, message: 'Name is required for new accounts' };
      }
      user = await this.prisma.user.create({
        data: { phoneNumber, name: name.trim() },
      });

      // Set verified name + self-declared contribution for the new user
      await this.identityService.setVerifiedName(phoneNumber, name.trim(), 'OTP_VERIFIED');
      await this.identityService.addNameContribution(
        phoneNumber, name.trim(), user.id, 'SELF_DECLARED',
      );

      this.logger.log(`New user created: ${phoneNumber} (${name})`);
    } else if (name && name.trim().length >= 2) {
      user = await this.prisma.user.update({
        where: { phoneNumber },
        data: { name: name.trim() },
      });
      // Update verified name
      await this.identityService.setVerifiedName(phoneNumber, name.trim(), 'OTP_VERIFIED');
      this.logger.log(`User ${phoneNumber} logged in, name updated to: ${name}`);
    } else {
      this.logger.log(`User ${phoneNumber} logged in`);
    }

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

  async firebaseLogin(dto: FirebaseLoginDto) {
    const { firebaseToken, name } = dto;

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await this.firebaseAdmin.auth().verifyIdToken(firebaseToken);
    } catch (error: any) {
      this.logger.error(`Firebase token verification failed: ${error.code} — ${error.message}`);
      throw new UnauthorizedException(
        `Firebase verification failed: ${error.code || error.message}`,
      );
    }

    const phoneNumber = decodedToken.phone_number;
    if (!phoneNumber) {
      throw new UnauthorizedException('No phone number found in Firebase token');
    }

    let user = await this.prisma.user.findUnique({
      where: { phoneNumber },
    });

    if (!user) {
      if (!name || name.trim().length < 2) {
        return { needsName: true, message: 'Name is required for new accounts' };
      }
      user = await this.prisma.user.create({
        data: { phoneNumber, name: name.trim() },
      });

      // Set verified name + self-declared contribution
      await this.identityService.setVerifiedName(phoneNumber, name.trim(), 'OTP_VERIFIED');
      await this.identityService.addNameContribution(
        phoneNumber, name.trim(), user.id, 'SELF_DECLARED',
      );

      this.logger.log(`New user created via Firebase: ${phoneNumber} (${name})`);
    } else if (name && name.trim().length >= 2) {
      user = await this.prisma.user.update({
        where: { phoneNumber },
        data: { name: name.trim() },
      });
      await this.identityService.setVerifiedName(phoneNumber, name.trim(), 'OTP_VERIFIED');
      this.logger.log(`User ${phoneNumber} logged in via Firebase, name updated`);
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

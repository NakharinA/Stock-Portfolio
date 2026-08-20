import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { CryptoService } from '../crypto/crypto.service';
import { GoogleProfile } from '../auth/interface/google-profile/google-profile.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Signing in and connecting Gmail are the same act here: the grant that proves who the
   * user is also carries the permission to read their confirmation notes.
   *
   * Google only returns a refresh token on the first consent, so an absent one on a later
   * sign-in is normal and must not overwrite the stored grant with nothing.
   */
  async upsertFromGoogle(profile: GoogleProfile): Promise<User> {
    const user = await this.prisma.user.upsert({
      where: { googleSub: profile.googleSub },
      create: { googleSub: profile.googleSub, email: profile.email, name: profile.name },
      update: { email: profile.email, name: profile.name },
    });

    if (profile.refreshToken) {
      const refreshTokenEnc = this.crypto.encrypt(profile.refreshToken);
      await this.prisma.googleGrant.upsert({
        where: { userId: user.id },
        create: { userId: user.id, refreshTokenEnc, scope: profile.scope },
        update: { refreshTokenEnc, scope: profile.scope, lastRefreshedAt: new Date() },
      });
    }

    // Every user needs somewhere to keep their broker settings before they can import.
    await this.prisma.brokerSetting.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });

    return user;
  }

  async hasGmailGrant(userId: string): Promise<boolean> {
    const grant = await this.prisma.googleGrant.findUnique({ where: { userId } });
    return grant !== null;
  }
}

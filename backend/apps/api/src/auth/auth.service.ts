import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { GoogleProfile } from './interface/google-profile/google-profile.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async signInWithGoogle(profile: GoogleProfile): Promise<{ accessToken: string }> {
    const user = await this.users.upsertFromGoogle(profile);
    return { accessToken: await this.jwt.signAsync({ sub: user.id, email: user.email }) };
  }
}

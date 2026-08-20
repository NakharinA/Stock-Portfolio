import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleProfile } from './interface/google-profile/google-profile.interface';
import { UsersService } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  /** Starts the Google consent flow. The guard does the redirecting. */
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  signIn(): void {
    return;
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async callback(@Req() request: { user: GoogleProfile }, @Res() response: Response): Promise<void> {
    const { accessToken } = await this.auth.signInWithGoogle(request.user);
    // Handed to the frontend in the URL fragment rather than the query string: fragments
    // are not sent to servers and do not end up in access logs or Referer headers.
    const frontend = this.config.getOrThrow<string>('FRONTEND_URL');
    response.redirect(`${frontend}/#access_token=${accessToken}`);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() userId: string) {
    const user = await this.users.findById(userId);
    return {
      id: user?.id,
      email: user?.email,
      name: user?.name,
      gmailConnected: await this.users.hasGmailGrant(userId),
    };
  }
}

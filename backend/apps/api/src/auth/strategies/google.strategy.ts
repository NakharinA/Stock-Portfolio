import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { GoogleProfile } from '../interface/google-profile/google-profile.interface';

/**
 * Signing in and granting mailbox access are one step: the same consent that identifies
 * the user also lets the importer read their confirmation notes.
 *
 * accessType 'offline' with prompt 'consent' is what makes Google return a refresh token.
 * Without both, a returning user consents again and the response carries no refresh token,
 * leaving the account signed in but unable to import.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly'],
    });
  }

  /**
   * access_type=offline is what makes Google issue a refresh token, and prompt=consent is
   * what makes it do so again for a user who has already consented once. They go through
   * this hook rather than the constructor options because that is where passport-oauth2
   * accepts extra authorization parameters.
   */
  authorizationParams(): Record<string, string> {
    return { access_type: 'offline', prompt: 'consent' };
  }

  validate(accessToken: string, refreshToken: string | undefined, profile: Profile, done: VerifyCallback): void {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('Google returned no email address'), false);
      return;
    }

    const user: GoogleProfile = {
      googleSub: profile.id,
      email,
      name: profile.displayName,
      refreshToken,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
    };
    done(null, user);
  }
}

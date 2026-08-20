import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { gmail_v1, google } from 'googleapis';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

export interface FetchedAttachment {
  messageId: string;
  filename: string;
  content: Buffer;
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  /**
   * A Gmail client acting as one user, from the refresh token their sign-in produced.
   * Access tokens are not stored: googleapis mints one per client from the refresh token,
   * and a short-lived token that lives only in memory is one less thing to leak.
   */
  private async clientFor(userId: string): Promise<gmail_v1.Gmail> {
    const grant = await this.prisma.googleGrant.findUnique({ where: { userId } });
    if (!grant) {
      throw new UnauthorizedException('this account has not granted Gmail access -- sign in again to authorise it');
    }

    const auth = new google.auth.OAuth2(
      this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      this.config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      this.config.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
    );
    auth.setCredentials({ refresh_token: this.crypto.decrypt(grant.refreshTokenEnc) });

    // Google rotates refresh tokens on some accounts; if it hands back a new one, the old
    // one stops working, so it has to be written down when it appears.
    auth.on('tokens', (tokens) => {
      if (!tokens.refresh_token) return;
      void this.prisma.googleGrant
        .update({
          where: { userId },
          data: { refreshTokenEnc: this.crypto.encrypt(tokens.refresh_token), lastRefreshedAt: new Date() },
        })
        .catch((error: unknown) => this.logger.error(`could not store rotated refresh token: ${String(error)}`));
    });

    return google.gmail({ version: 'v1', auth });
  }

  private collectPdfParts(part: gmail_v1.Schema$MessagePart | undefined, found: { filename: string; attachmentId: string }[]): void {
    if (!part) return;
    for (const child of part.parts ?? []) this.collectPdfParts(child, found);
    const filename = part.filename ?? '';
    const attachmentId = part.body?.attachmentId;
    if (filename.toLowerCase().endsWith('.pdf') && attachmentId) found.push({ filename, attachmentId });
  }

  /**
   * Every PDF attached to a message matching the query, except those already recorded as
   * imported. The skip list is passed in rather than queried here so this class stays
   * about Gmail and nothing else.
   */
  async fetchAttachments(
    userId: string,
    query: string,
    alreadySeen: Set<string>,
    maxMessages = 200,
  ): Promise<FetchedAttachment[]> {
    const gmail = await this.clientFor(userId);
    const listing = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: maxMessages });
    const messages = listing.data.messages ?? [];

    const out: FetchedAttachment[] = [];
    for (const stub of messages) {
      if (!stub.id) continue;
      const message = await gmail.users.messages.get({ userId: 'me', id: stub.id, format: 'full' });

      const parts: { filename: string; attachmentId: string }[] = [];
      this.collectPdfParts(message.data.payload ?? undefined, parts);

      for (const part of parts) {
        if (alreadySeen.has(`${stub.id}:${part.filename}`)) continue;
        const attachment = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: stub.id,
          id: part.attachmentId,
        });
        if (!attachment.data.data) continue;
        out.push({
          messageId: stub.id,
          filename: part.filename,
          content: Buffer.from(attachment.data.data, 'base64url'),
        });
      }
    }
    return out;
  }
}

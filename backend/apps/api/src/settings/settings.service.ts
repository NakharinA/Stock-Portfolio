import { Injectable } from '@nestjs/common';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBrokerSettingDto } from './dto/update-broker-setting.dto';

export interface BrokerSettingView {
  gmailQuery: string;
  /** Whether a password is stored. The password itself is never sent back. */
  pdfPasswordSet: boolean;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async find(userId: string): Promise<BrokerSettingView> {
    const row = await this.prisma.brokerSetting.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return { gmailQuery: row.gmailQuery, pdfPasswordSet: row.pdfPasswordEnc !== null };
  }

  async update(userId: string, dto: UpdateBrokerSettingDto): Promise<BrokerSettingView> {
    const row = await this.prisma.brokerSetting.upsert({
      where: { userId },
      create: {
        userId,
        ...(dto.pdfPassword ? { pdfPasswordEnc: this.crypto.encrypt(dto.pdfPassword) } : {}),
        ...(dto.gmailQuery ? { gmailQuery: dto.gmailQuery } : {}),
      },
      update: {
        ...(dto.pdfPassword ? { pdfPasswordEnc: this.crypto.encrypt(dto.pdfPassword) } : {}),
        ...(dto.gmailQuery ? { gmailQuery: dto.gmailQuery } : {}),
      },
    });
    return { gmailQuery: row.gmailQuery, pdfPasswordSet: row.pdfPasswordEnc !== null };
  }
}

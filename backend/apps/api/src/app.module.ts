import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CryptoModule } from './crypto/crypto.module';
import { LegacyImportModule } from './legacy-import/legacy-import.module';
import { PricesModule } from './prices/prices.module';
import { PrismaModule } from './prisma/prisma.module';
import { TransactionsModule } from './transactions/transactions.module';
import { UsersModule } from './users/users.module';
import { IngestModule } from './ingest/ingest.module';
import { SettingsModule } from './settings/settings.module';
import { StatementsModule } from './statements/statements.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    PrismaModule,
    CryptoModule,
    UsersModule,
    AuthModule,
    TransactionsModule,
    PricesModule,
    LegacyImportModule,
    IngestModule,
    SettingsModule,
    StatementsModule,
  ],
})
export class AppModule {}

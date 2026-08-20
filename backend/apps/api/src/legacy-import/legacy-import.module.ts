import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { LegacyImportController } from './legacy-import.controller';
import { LegacyImportService } from './legacy-import.service';

@Module({
  imports: [UsersModule],
  controllers: [LegacyImportController],
  providers: [LegacyImportService],
})
export class LegacyImportModule {}

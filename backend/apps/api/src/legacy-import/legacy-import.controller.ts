import { Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LegacyImportService } from './legacy-import.service';

@Controller('legacy-import')
@UseGuards(JwtAuthGuard)
export class LegacyImportController {
  constructor(private readonly legacyImport: LegacyImportService) {}

  /** Imports the JSON files into the calling user's account. Running it twice is a no-op. */
  @Post()
  run(@CurrentUser() userId: string) {
    return this.legacyImport.run(userId);
  }
}

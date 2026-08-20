import { Controller, ForbiddenException, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { LegacyImportService } from './legacy-import.service';

@Controller('legacy-import')
@UseGuards(JwtAuthGuard)
export class LegacyImportController {
  constructor(
    private readonly legacyImport: LegacyImportService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Loads the pre-database JSON files into an account.
   *
   * Those files hold one specific person's portfolio, so this is not something any signed-in
   * user may do: on a shared instance that would hand a stranger someone else's holdings.
   * It runs only for the address named in LEGACY_IMPORT_EMAIL, and the whole route is off
   * unless that variable is set. It is a migration aid, not a feature.
   */
  @Post()
  async run(@CurrentUser() userId: string) {
    const allowed = this.config.get<string>('LEGACY_IMPORT_EMAIL');
    if (!allowed) throw new ForbiddenException('legacy import is disabled');

    const user = await this.users.findById(userId);
    if (!user || user.email.toLowerCase() !== allowed.toLowerCase()) {
      throw new ForbiddenException('legacy import is not available for this account');
    }

    return this.legacyImport.run(userId);
  }
}

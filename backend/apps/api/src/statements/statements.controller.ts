import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StatementsService } from './statements.service';

@Controller('statements')
@UseGuards(JwtAuthGuard)
export class StatementsController {
  constructor(private readonly statements: StatementsService) {}

  /** Every monthly statement imported for this account, oldest first. */
  @Get()
  findAll(@CurrentUser() userId: string) {
    return this.statements.findAll(userId);
  }
}

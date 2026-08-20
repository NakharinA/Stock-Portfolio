import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IngestService } from './ingest.service';

@Controller('ingest')
@UseGuards(JwtAuthGuard)
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post('sync')
  sync(@CurrentUser() userId: string) {
    return this.ingest.startSync(userId);
  }

  @Get('jobs')
  jobs(@CurrentUser() userId: string) {
    return this.ingest.listJobs(userId);
  }

  @Get('jobs/:id')
  async job(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    const job = await this.ingest.findJob(userId, id);
    if (!job) throw new NotFoundException('job not found');
    return job;
  }
}

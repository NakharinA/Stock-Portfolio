import { Module } from '@nestjs/common';
import { GmailService } from './gmail.service';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { ParserService } from './parser.service';

@Module({
  controllers: [IngestController],
  providers: [IngestService, GmailService, ParserService],
  exports: [IngestService],
})
export class IngestModule {}

import { Module } from '@nestjs/common';
import { StatementsModule } from '../statements/statements.module';
import { GmailService } from './gmail.service';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { ParserService } from './parser.service';

@Module({
  imports: [StatementsModule],
  controllers: [IngestController],
  providers: [IngestService, GmailService, ParserService],
  exports: [IngestService],
})
export class IngestModule {}

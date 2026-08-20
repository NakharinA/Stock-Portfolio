import { Module } from '@nestjs/common';
import { PricesController } from './prices.controller';
import { PricesService } from './prices.service';
import { QuotesService } from './quotes.service';

@Module({
  controllers: [PricesController],
  providers: [PricesService, QuotesService],
  exports: [PricesService],
})
export class PricesModule {}

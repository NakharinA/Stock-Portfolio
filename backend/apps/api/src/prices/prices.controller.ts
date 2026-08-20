import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SetPriceDto } from './dto/set-price.dto';
import { SetYearEndPriceDto } from './dto/set-year-end-price.dto';
import { PricesService } from './prices.service';

@Controller('prices')
@UseGuards(JwtAuthGuard)
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @Get()
  findAll(@CurrentUser() userId: string) {
    return this.prices.findAll(userId);
  }

  @Put(':ticker')
  setOverride(@CurrentUser() userId: string, @Param('ticker') ticker: string, @Body() dto: SetPriceDto) {
    return this.prices.setOverride(userId, ticker, dto.price);
  }

  @Delete(':ticker')
  clearOverride(@CurrentUser() userId: string, @Param('ticker') ticker: string) {
    return this.prices.clearOverride(userId, ticker);
  }

  @Get('year-end/all')
  findYearEnd() {
    return this.prices.findYearEnd();
  }

  @Put('year-end/:ticker')
  setYearEnd(@Param('ticker') ticker: string, @Body() dto: SetYearEndPriceDto) {
    return this.prices.setYearEnd(ticker, dto.year, dto.price);
  }
}

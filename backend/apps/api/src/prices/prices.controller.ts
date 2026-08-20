import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
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

  /** Fetches fresh market prices for everything this user holds. Rate limited per account. */
  @Post('refresh')
  refresh(@CurrentUser() userId: string) {
    return this.prices.refresh(userId);
  }

  @Put(':ticker')
  setOverride(@CurrentUser() userId: string, @Param('ticker') ticker: string, @Body() dto: SetPriceDto) {
    return this.prices.setOverride(userId, ticker, dto.price);
  }

  @Delete(':ticker')
  clearOverride(@CurrentUser() userId: string, @Param('ticker') ticker: string) {
    return this.prices.clearOverride(userId, ticker);
  }

  /** Fills in missing 31 December closes from market history, so they need not be typed. */
  @Post('year-end/backfill')
  backfillYearEnd(@CurrentUser() userId: string) {
    return this.prices.backfillYearEnd(userId);
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

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PriceView {
  ticker: string;
  price: string;
  /** 'user' when this person typed it in, 'market' when it came from the price fetcher. */
  source: 'user' | 'market';
  fetchedAt: Date | null;
}

@Injectable()
export class PricesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Market prices are shared, overrides are personal, and an override always wins for the
   * person who set it -- they are saying they know better than the last fetch.
   */
  async findAll(userId: string): Promise<PriceView[]> {
    const [market, overrides] = await Promise.all([
      this.prisma.price.findMany(),
      this.prisma.priceOverride.findMany({ where: { userId } }),
    ]);

    const byTicker = new Map<string, PriceView>();
    for (const row of market) {
      byTicker.set(row.ticker, {
        ticker: row.ticker,
        price: row.price.toString(),
        source: 'market',
        fetchedAt: row.fetchedAt,
      });
    }
    for (const row of overrides) {
      byTicker.set(row.ticker, { ticker: row.ticker, price: row.price.toString(), source: 'user', fetchedAt: null });
    }
    return [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  }

  async setOverride(userId: string, ticker: string, price: number): Promise<PriceView> {
    const key = ticker.toUpperCase();
    const row = await this.prisma.priceOverride.upsert({
      where: { userId_ticker: { userId, ticker: key } },
      create: { userId, ticker: key, price },
      update: { price },
    });
    return { ticker: row.ticker, price: row.price.toString(), source: 'user', fetchedAt: null };
  }

  async clearOverride(userId: string, ticker: string): Promise<{ ticker: string }> {
    const key = ticker.toUpperCase();
    await this.prisma.priceOverride.deleteMany({ where: { userId, ticker: key } });
    return { ticker: key };
  }

  async findYearEnd(): Promise<Record<string, Record<string, string>>> {
    const rows = await this.prisma.yearEndPrice.findMany();
    const byYear: Record<string, Record<string, string>> = {};
    for (const row of rows) {
      byYear[row.year] ??= {};
      byYear[row.year][row.ticker] = row.price.toString();
    }
    return byYear;
  }

  async setYearEnd(ticker: string, year: number, price: number): Promise<{ ticker: string; year: number }> {
    const key = ticker.toUpperCase();
    await this.prisma.yearEndPrice.upsert({
      where: { ticker_year: { ticker: key, year } },
      create: { ticker: key, year, price },
      update: { price },
    });
    return { ticker: key, year };
  }
}

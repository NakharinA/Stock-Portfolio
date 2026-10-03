import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JobKind, JobState, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuotesService } from './quotes.service';

export interface PriceView {
  ticker: string;
  price: string;
  /** 'user' when this person typed it in, 'market' when it came from the price fetcher. */
  source: 'user' | 'market';
  fetchedAt: Date | null;
}

/** How long a user must wait between price refreshes. */
export const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

/** How long a fetched price history is reused before Yahoo is asked again. */
export const HISTORY_CACHE_MS = 6 * 60 * 60 * 1000;

export interface PriceHistoryView {
  start: string;
  end: string;
  /** ticker -> ISO day -> close */
  history: Record<string, Record<string, number>>;
  failed: string[];
}

export interface RefreshResult {
  updated: number;
  tickers: string[];
  failed: string[];
  fetchedAt: Date;
}

@Injectable()
export class PricesService {
  private readonly logger = new Logger(PricesService.name);
  /** Keyed by ticker list and range: the history of a day that has closed never changes. */
  private readonly historyCache = new Map<string, { at: number; value: PriceHistoryView }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: QuotesService,
  ) {}

  /** Tickers this user held on a given day, or today when no cutoff is given. */
  private async heldTickers(userId: string, asOf?: Date): Promise<string[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: { in: [TransactionType.BUY, TransactionType.SELL] },
        ...(asOf ? { tradeDate: { lte: asOf } } : {}),
      },
      orderBy: { tradeDate: 'asc' },
      select: { ticker: true, type: true, qty: true },
    });

    const held = new Map<string, number>();
    for (const row of rows) {
      const qty = Number(row.qty ?? 0);
      held.set(row.ticker, (held.get(row.ticker) ?? 0) + (row.type === TransactionType.BUY ? qty : -qty));
    }
    // A sold-out position lands on a tiny residue rather than exactly zero, because the
    // broker deals in seven decimals.
    return [...held.entries()].filter(([, qty]) => qty > 1e-6).map(([ticker]) => ticker).sort();
  }

  /**
   * Refreshes the market price of everything this user holds.
   *
   * Rate limited per account: the quotes upstream is a public endpoint being used politely,
   * and a button that can be held down is the fastest way to lose access to it.
   */
  async refresh(userId: string): Promise<RefreshResult> {
    const since = new Date(Date.now() - REFRESH_COOLDOWN_MS);
    const recent = await this.prisma.importJob.findFirst({
      where: { userId, kind: JobKind.PRICES, startedAt: { gt: since } },
      orderBy: { startedAt: 'desc' },
    });
    if (recent) {
      const waitSeconds = Math.ceil((recent.startedAt.getTime() + REFRESH_COOLDOWN_MS - Date.now()) / 1000);
      throw new HttpException(
        { message: `ดึงราคาได้อีกครั้งในอีก ${waitSeconds} วินาที`, retryAfterSeconds: waitSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const tickers = await this.heldTickers(userId);
    if (tickers.length === 0) {
      throw new HttpException({ message: 'ยังไม่มีหุ้นในพอร์ต จึงไม่มีราคาให้ดึง' }, HttpStatus.BAD_REQUEST);
    }

    const job = await this.prisma.importJob.create({ data: { userId, kind: JobKind.PRICES } });
    try {
      const result = await this.quotes.fetch(tickers);
      for (const [ticker, price] of Object.entries(result.prices)) {
        await this.prisma.price.upsert({
          where: { ticker },
          create: { ticker, price, fetchedAt: result.fetchedAt },
          update: { price, fetchedAt: result.fetchedAt },
        });
      }

      const updated = Object.keys(result.prices).length;
      await this.prisma.importJob.update({
        where: { id: job.id },
        data: {
          state: JobState.DONE,
          finishedAt: new Date(),
          log: { push: `ดึงราคา ${updated} ตัว${result.failed.length ? ` · ไม่สำเร็จ ${result.failed.join(', ')}` : ''}` },
        },
      });

      return { updated, tickers, failed: result.failed, fetchedAt: result.fetchedAt };
    } catch (error) {
      await this.prisma.importJob.update({
        where: { id: job.id },
        data: { state: JobState.ERROR, error: String(error), finishedAt: new Date() },
      });
      this.logger.error(`price refresh failed for ${userId}: ${String(error)}`);
      throw new HttpException({ message: 'ดึงราคาไม่สำเร็จ' }, HttpStatus.BAD_GATEWAY);
    }
  }

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

  /**
   * Daily closes for every ticker this user has ever traded, from their first trade to today.
   * The dashboard uses them to value the portfolio on each day it traded, which is what a
   * time-weighted return needs. Cached for a few hours: history is the same for everyone and
   * Yahoo is slow and rate limited.
   */
  async history(userId: string): Promise<PriceHistoryView> {
    const rows = await this.prisma.transaction.findMany({
      where: { userId },
      select: { ticker: true, tradeDate: true },
      orderBy: { tradeDate: 'asc' },
    });
    if (rows.length === 0) return { start: '', end: '', history: {}, failed: [] };

    const tickers = [...new Set(rows.map((row) => row.ticker))].sort();
    const start = rows[0].tradeDate.toISOString().slice(0, 10);
    const end = new Date().toISOString().slice(0, 10);
    const key = `${tickers.join(',')}|${start}|${end}`;
    const cached = this.historyCache.get(key);
    if (cached && Date.now() - cached.at < HISTORY_CACHE_MS) return cached.value;

    try {
      const result = await this.quotes.history(tickers, start, end);
      const value = { start, end, history: result.history, failed: result.failed ?? [] };
      this.historyCache.set(key, { at: Date.now(), value });
      return value;
    } catch (error) {
      this.logger.error(`price history failed for ${userId}: ${String(error)}`);
      throw new HttpException({ message: 'ดึงราคาย้อนหลังไม่สำเร็จ' }, HttpStatus.BAD_GATEWAY);
    }
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

  /**
   * Fills in the 31 December closing prices the yearly-return chart needs, for every past
   * year this user held anything, and only for the tickers they actually held at that year
   * end -- valuing a position they had already sold would be meaningless.
   *
   * Prices already stored are left alone, including ones typed in by hand: a figure someone
   * entered deliberately is not overwritten by a fetch.
   */
  async backfillYearEnd(userId: string): Promise<{ filled: number; skipped: number; failed: string[]; years: number[] }> {
    const first = await this.prisma.transaction.findFirst({ where: { userId }, orderBy: { tradeDate: 'asc' } });
    if (!first) throw new HttpException({ message: 'ยังไม่มีธุรกรรมในพอร์ต' }, HttpStatus.BAD_REQUEST);

    const firstYear = first.tradeDate.getUTCFullYear();
    const thisYear = new Date().getUTCFullYear();

    let filled = 0;
    let skipped = 0;
    const failed: string[] = [];
    const years: number[] = [];

    for (let year = firstYear; year < thisYear; year += 1) {
      const cutoff = new Date(Date.UTC(year, 11, 31));
      const held = await this.heldTickers(userId, cutoff);
      if (held.length === 0) continue;

      const existing = await this.prisma.yearEndPrice.findMany({
        where: { year, ticker: { in: held } },
        select: { ticker: true },
      });
      const have = new Set(existing.map((row) => row.ticker));
      const missing = held.filter((ticker) => !have.has(ticker));
      skipped += held.length - missing.length;
      if (missing.length === 0) continue;

      years.push(year);
      try {
        const result = await this.quotes.closesOn(missing, `${year}-12-31`);
        for (const [ticker, close] of Object.entries(result.closes)) {
          await this.prisma.yearEndPrice.upsert({
            where: { ticker_year: { ticker, year } },
            create: { ticker, year, price: close.price },
            update: { price: close.price },
          });
          filled += 1;
        }
        failed.push(...result.failed.map((ticker) => `${ticker} (${year})`));
      } catch (error) {
        this.logger.error(`year-end backfill failed for ${year}: ${String(error)}`);
        failed.push(...missing.map((ticker) => `${ticker} (${year})`));
      }
    }

    return { filled, skipped, failed, years };
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

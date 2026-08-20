import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TransactionSource, TransactionType } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

interface LegacyRow {
  id: string;
  date: string;
  ticker: string;
  type: string;
  qty: number;
  price: number;
  fee: number;
  order_id?: string;
  source?: string;
  note?: string;
}

export interface ImportSummary {
  transactions: { read: number; inserted: number; skipped: number };
  prices: number;
  yearEndPrices: number;
  warnings: string[];
}

/**
 * Moves the single-user JSON files into the database under one account. It exists because
 * the dashboard's history predates the database, and re-deriving it from the broker's
 * mail would still lose the dividends and the two trades no confirmation note covers.
 *
 * Safe to run twice: rows are keyed by the id the files already carry, so a second run
 * inserts nothing.
 */
@Injectable()
export class LegacyImportService {
  private readonly logger = new Logger(LegacyImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get dataDir(): string {
    return this.config.get<string>('LEGACY_DATA_DIR') ?? '/app/legacy-data';
  }

  private async readJson<T>(filename: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(join(this.dataDir, filename), 'utf8')) as T;
    } catch {
      return null;
    }
  }

  private toType(raw: string): TransactionType | null {
    switch (raw) {
      case 'buy':
        return TransactionType.BUY;
      case 'sell':
        return TransactionType.SELL;
      case 'dividend':
        return TransactionType.DIVIDEND;
      default:
        return null;
    }
  }

  async run(userId: string): Promise<ImportSummary> {
    const warnings: string[] = [];
    const files = ['transactions.json', 'dividends.json', 'manual_transactions.json'];
    const rows: LegacyRow[] = [];

    for (const file of files) {
      const parsed = await this.readJson<{ transactions?: LegacyRow[] } | LegacyRow[]>(file);
      if (!parsed) {
        warnings.push(`${file} not found in ${this.dataDir}`);
        continue;
      }
      rows.push(...(Array.isArray(parsed) ? parsed : (parsed.transactions ?? [])));
    }

    const data: Prisma.TransactionCreateManyInput[] = [];
    for (const row of rows) {
      const type = this.toType(row.type);
      if (!type) {
        warnings.push(`skipped ${row.id}: unknown type "${row.type}"`);
        continue;
      }

      const isDividend = type === TransactionType.DIVIDEND;
      data.push({
        userId,
        externalId: row.id,
        tradeDate: new Date(row.date),
        ticker: row.ticker.toUpperCase(),
        type,
        // The files carry the dividend amount in the qty field, which is exactly the
        // overloading the database schema replaced. Unpick it on the way in.
        qty: isDividend ? null : row.qty,
        price: isDividend ? null : row.price,
        amount: isDividend ? row.qty : null,
        fee: row.fee ?? 0,
        orderId: row.order_id ?? null,
        sourceFile: row.source ?? null,
        note: row.note ?? null,
        source: row.id.startsWith('i-') ? TransactionSource.CONFIRMATION_NOTE : TransactionSource.MANUAL,
      });
    }

    const inserted = await this.prisma.transaction.createMany({ data, skipDuplicates: true });

    const priceFile = await this.readJson<{ fetched_at?: string; prices?: Record<string, number> }>('prices.json');
    let prices = 0;
    if (priceFile?.prices) {
      const fetchedAt = priceFile.fetched_at ? new Date(priceFile.fetched_at) : new Date();
      for (const [ticker, price] of Object.entries(priceFile.prices)) {
        await this.prisma.price.upsert({
          where: { ticker: ticker.toUpperCase() },
          create: { ticker: ticker.toUpperCase(), price, fetchedAt },
          update: { price, fetchedAt },
        });
        prices += 1;
      }
    } else {
      warnings.push('prices.json not found or empty');
    }

    const yearEndFile = await this.readJson<{ years?: Record<string, Record<string, number>> }>('year_end_prices.json');
    let yearEndPrices = 0;
    for (const [year, tickers] of Object.entries(yearEndFile?.years ?? {})) {
      for (const [ticker, price] of Object.entries(tickers)) {
        await this.prisma.yearEndPrice.upsert({
          where: { ticker_year: { ticker: ticker.toUpperCase(), year: Number(year) } },
          create: { ticker: ticker.toUpperCase(), year: Number(year), price },
          update: { price },
        });
        yearEndPrices += 1;
      }
    }

    const summary: ImportSummary = {
      transactions: { read: rows.length, inserted: inserted.count, skipped: rows.length - inserted.count },
      prices,
      yearEndPrices,
      warnings,
    };
    this.logger.log(`legacy import for ${userId}: ${JSON.stringify(summary.transactions)}`);
    return summary;
  }
}

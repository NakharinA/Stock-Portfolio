import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface QuoteResult {
  prices: Record<string, number>;
  failed: string[];
  fetchedAt: Date;
}

export interface CloseResult {
  /** ticker -> the last close on or before the requested day */
  closes: Record<string, { date: string; price: number }>;
  failed: string[];
}

export class QuotesError extends Error {}

/** Client for the quotes service, which is the only thing here that talks to the market. */
@Injectable()
export class QuotesService {
  constructor(private readonly config: ConfigService) {}

  private base(): string {
    return this.config.get<string>('QUOTES_URL') ?? 'http://quotes:8200';
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base()}${path}`);
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      const detail =
        body && typeof body === 'object' && 'detail' in body
          ? String((body as { detail: unknown }).detail)
          : `quotes service returned ${res.status}`;
      throw new QuotesError(detail);
    }
    return (await res.json()) as T;
  }

  /** Closing price on or before a day -- 31 December is often not a trading day. */
  async closesOn(tickers: string[], on: string): Promise<CloseResult> {
    return this.get<CloseResult>(`/closes?tickers=${encodeURIComponent(tickers.join(','))}&on=${on}`);
  }

  async fetch(tickers: string[]): Promise<QuoteResult> {
    const base = this.config.get<string>('QUOTES_URL') ?? 'http://quotes:8200';
    const url = `${base}/quotes?tickers=${encodeURIComponent(tickers.join(','))}`;

    const res = await fetch(url);
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      const detail =
        body && typeof body === 'object' && 'detail' in body
          ? String((body as { detail: unknown }).detail)
          : `quotes service returned ${res.status}`;
      throw new QuotesError(detail);
    }

    const data = (await res.json()) as { prices: Record<string, number>; failed: string[]; fetched_at: string };
    return { prices: data.prices, failed: data.failed ?? [], fetchedAt: new Date(data.fetched_at) };
  }
}

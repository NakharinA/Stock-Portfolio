/** One trade as the PDF parser reports it. Amounts are in the note's currency, USD. */
export interface ParsedRow {
  date: string;
  ticker: string;
  type: 'buy' | 'sell';
  qty: number;
  price: number;
  fee: number;
  order_id?: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  /** True for a real Dime document this pipeline does not read, such as a mutual fund note. */
  skipped: boolean;
  reason?: string;
  source: string;
}

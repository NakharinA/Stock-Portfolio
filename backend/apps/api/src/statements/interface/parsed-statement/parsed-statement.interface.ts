/** The offshore part of one monthly statement as the PDF parser reports it. Amounts in USD. */
export interface ParsedStatement {
  as_of: string;
  total_balance: number;
  cash_balance: number;
  dividends_since_start: number;
  /** ticker -> shares held */
  holdings: Record<string, number>;
}

export interface StatementParseResult {
  /** Null when the statement has no offshore account to read. */
  statement: ParsedStatement | null;
  skipped: boolean;
  reason?: string;
  source: string;
}

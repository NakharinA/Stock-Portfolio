/** One monthly statement as the dashboard reads it. Decimals are strings, as elsewhere in the API. */
export interface StatementView {
  asOf: string;
  totalBalance: string;
  cashBalance: string;
  dividendsSinceStart: string;
  holdings: Record<string, number>;
}

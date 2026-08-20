import { createHash } from 'node:crypto';
import { ParsedRow } from '../interface/parsed-row/parsed-row.interface';

/**
 * The id a trade gets, derived from the trade itself rather than from the file it arrived
 * in, so the same trade re-sent in a corrected statement lands on the same row.
 *
 * The digest must stay byte-identical to tx_store.tx_id in the Python importer: both write
 * into the same table, and a drift in either would import every row a second time. Hence
 * the fixed decimal places, which are the shared contract, not a formatting choice.
 */
export function externalIdFor(row: Pick<ParsedRow, 'date' | 'ticker' | 'type' | 'qty' | 'price' | 'fee'>): string {
  const key = [
    row.date,
    row.ticker.toUpperCase(),
    row.type,
    row.qty.toFixed(7),
    row.price.toFixed(6),
    row.fee.toFixed(4),
  ].join('|');
  return 'i-' + createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 10);
}

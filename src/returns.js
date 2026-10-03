// Yearly profit of the whole port, from the money deposited and the port's value at each
// year end:
//
//   profit of the year = end value − start value − money deposited in the year
//   return             = profit ÷ (start value + money deposited in the year)
//   total return       = (value now − total deposited) ÷ total deposited
//   XIRR               = the yearly rate that makes the deposits grow into today's value
//
// The start value is last year's end value, so last year's profit counts as capital this year.
// Port value is every stock at market price plus the cash sitting in the port.
//
// Where the money came from is worked out from cash. Between two monthly statements:
//
//   deposited = cash on this statement − cash on the last one − money from sells − dividends + money spent on buys
//
// which is exact, withdrawals included (they come out negative). After the last statement,
// or with no statements at all, cash is followed from the trades: sells and dividends add to
// it, buys are paid from it, and whatever a buy needs beyond it is counted as a deposit that
// day. The next statement then corrects whatever that guess got wrong.
//
// Pure functions, no React, so they can be checked against real data from a script.

const DAY_MS = 24 * 60 * 60 * 1000;

const toTime = (day) => new Date(`${day}T00:00:00Z`).getTime();
const addDays = (day, n) => new Date(toTime(day) + n * DAY_MS).toISOString().slice(0, 10);

// Last close on or before `day`, from a { "YYYY-MM-DD": close } map. Dates are kept sorted per
// ticker so this is a binary search.
function makeCloseLookup(history) {
  const sortedDates = {};
  for (const [ticker, byDay] of Object.entries(history || {})) sortedDates[ticker] = Object.keys(byDay).sort();
  return (ticker, day) => {
    const dates = sortedDates[ticker];
    if (!dates || dates.length === 0 || dates[0] > day) return null;
    let lo = 0;
    let hi = dates.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (dates[mid] <= day) lo = mid;
      else hi = mid - 1;
    }
    return history[ticker][dates[lo]];
  };
}

// Same as Excel's XIRR: flows are { t: ms, c: amount }, money in negative.
function xirr(flows) {
  if (flows.length < 2 || !flows.some((f) => f.c < 0) || !flows.some((f) => f.c > 0)) return null;
  const t0 = flows[0].t;
  const npv = (r) => flows.reduce((s, f) => s + f.c * Math.pow(1 + r, -(f.t - t0) / DAY_MS / 365), 0);
  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  if (flo * npv(hi) > 0) {
    hi = 1000;
    if (flo * npv(hi) > 0) return null;
  }
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

/**
 * @param txs        [{ date, ticker, type: "buy"|"sell"|"dividend", qty, price, fee }]; for a
 *                   dividend, qty holds the amount received
 * @param statements [{ asOf, totalBalance, cashBalance, dividendsSinceStart, holdings }] monthly
 *                   statements (numbers or numeric strings), any order; may be empty
 * @param history    { ticker: { "YYYY-MM-DD": close } } daily closes
 * @param livePrices { ticker: price } used for today's valuation when present
 * @param today      "YYYY-MM-DD"
 * @returns {{ years, deposits, monthlyDeposits, cashByMonth, totalDeposited, valueNow, cashNow, totalProfit,
 *             totalPct, xirrPct, statementCount, lastStatement, mismatches, approxTickers }}
 *          cashByMonth is { "YYYY-MM": cash in the port at the end of that month }, for months with
 *          any trade or statement
 *          percentages are in percent (12.3 means 12.3%)
 */
export function portReturns(txs, statements, history, livePrices, today) {
  const sorted = [...txs].filter((t) => t.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const stmts = (statements || [])
    .filter((s) => s.asOf <= today)
    .map((s) => ({
      asOf: s.asOf,
      total: Number(s.totalBalance),
      cash: Number(s.cashBalance),
      dividends: Number(s.dividendsSinceStart || 0),
      holdings: s.holdings || {},
    }))
    .sort((a, b) => a.asOf.localeCompare(b.asOf));
  const empty = {
    years: [],
    deposits: [],
    monthlyDeposits: [],
    cashByMonth: {},
    totalDeposited: 0,
    valueNow: 0,
    cashNow: 0,
    totalProfit: 0,
    totalPct: null,
    xirrPct: null,
    statementCount: stmts.length,
    lastStatement: stmts.length ? stmts[stmts.length - 1].asOf : null,
    mismatches: [],
    approxTickers: [],
  };
  if (sorted.length === 0 && stmts.length === 0) return empty;

  const closeOn = makeCloseLookup(history);
  const lastTradePrice = {}; // fallback when a ticker has no market history at all
  const approx = new Set();
  const priceOf = (ticker, day) => {
    if (day === today) {
      const live = parseFloat(livePrices?.[ticker]);
      if (isFinite(live) && live > 0) return live;
    }
    const close = closeOn(ticker, day);
    if (close !== null) return close;
    approx.add(ticker);
    return lastTradePrice[ticker] ?? 0;
  };

  const qty = {}; // shares held, never below zero
  const recordedQty = {}; // buys minus sells as recorded, to set against the statements
  let cash = 0;
  let dividendsInRecords = 0; // dividends on record since the last statement
  let lastStatementDividends = 0;
  const deposits = [];
  const mismatches = [];
  const cashByMonth = {};

  const firstDay = [sorted[0]?.date, stmts[0]?.asOf].filter(Boolean).sort()[0];
  const firstYear = Number(firstDay.slice(0, 4));
  const nowYear = Number(today.slice(0, 4));
  const yearEnds = [];
  for (let y = firstYear; y < nowYear; y++) yearEnds.push(`${y}-12-31`);
  const days = [...new Set([...sorted.map((t) => t.date), ...stmts.map((s) => s.asOf), ...yearEnds, today])].sort();

  const points = {};
  let lastStatementSeen = null;
  let i = 0;
  let si = 0;
  for (const day of days) {
    // Trades first, money coming in before money going out: selling one stock to buy another
    // the same day is a switch inside the port, not a deposit.
    const sameDay = [];
    while (i < sorted.length && sorted[i].date === day) sameDay.push(sorted[i++]);
    for (const t of sameDay) {
      if (t.type === "sell") {
        const held = qty[t.ticker] || 0;
        // Selling more than is held means a buy is missing from the records. Only the part
        // that was held produced money that can be accounted for.
        const sellQty = Math.min(t.qty, held);
        if (sellQty > 0) cash += sellQty * t.price - t.fee * (sellQty / t.qty);
        qty[t.ticker] = held - sellQty;
        recordedQty[t.ticker] = (recordedQty[t.ticker] || 0) - t.qty;
        lastTradePrice[t.ticker] = t.price;
      } else if (t.type === "dividend") {
        cash += t.qty;
        dividendsInRecords += t.qty;
      }
    }
    for (const t of sameDay) {
      if (t.type !== "buy") continue;
      const cost = t.qty * t.price + t.fee;
      const fromCash = Math.min(cash, cost);
      cash -= fromCash;
      if (cost - fromCash > 1e-6) deposits.push({ date: day, amount: cost - fromCash, fromStatement: false });
      qty[t.ticker] = (qty[t.ticker] || 0) + t.qty;
      recordedQty[t.ticker] = (recordedQty[t.ticker] || 0) + t.qty;
      lastTradePrice[t.ticker] = t.price;
    }

    // A statement closes the day: its cash is the real figure, and the gap to the cash
    // followed from the trades is money deposited (or withdrawn) that the trades cannot show.
    while (si < stmts.length && stmts[si].asOf === day) {
      const s = stmts[si++];
      const dividendsNotOnRecord = Math.max(0, s.dividends - lastStatementDividends - dividendsInRecords);
      cash += dividendsNotOnRecord;
      const gap = s.cash - cash;
      if (Math.abs(gap) > 0.005) deposits.push({ date: day, amount: gap, fromStatement: true });
      cash = s.cash;
      lastStatementDividends = s.dividends;
      dividendsInRecords = 0;
      lastStatementSeen = s;

      const tickers = new Set([...Object.keys(s.holdings), ...Object.keys(recordedQty).filter((k) => Math.abs(recordedQty[k]) > 1e-6)]);
      const diffs = [];
      for (const ticker of tickers) {
        const onStatement = Number(s.holdings[ticker] || 0);
        const onRecord = recordedQty[ticker] || 0;
        if (Math.abs(onStatement - onRecord) > 1e-4) diffs.push({ ticker, onStatement, onRecord });
      }
      if (diffs.length) mismatches.push({ asOf: s.asOf, diffs });
    }

    cashByMonth[day.slice(0, 7)] = cash;

    if (day === today || yearEnds.includes(day)) {
      // The statement's own figure when one closes this year (Dime values the port, not us);
      // otherwise every stock at that day's close plus the cash.
      const s = lastStatementSeen;
      if (s && day !== today && s.asOf >= addDays(day, -7) && s.asOf <= day && !sorted.some((t) => t.date > s.asOf && t.date <= day)) {
        points[day] = s.total + s.cash;
      } else {
        let value = cash;
        for (const [ticker, q] of Object.entries(qty)) if (q > 1e-7) value += q * priceOf(ticker, day);
        points[day] = value;
      }
    }
  }

  if (deposits.length === 0) return { ...empty, approxTickers: [...approx].sort() };

  // Split by year. The first period opens on the first deposit.
  const years = [];
  let prevDate = deposits[0].date;
  let prevValue = 0;
  let first = true;
  for (const point of [...yearEnds, today]) {
    if (point < prevDate) continue;
    const inPeriod = deposits.filter((d) => (first ? d.date >= prevDate : d.date > prevDate) && d.date <= point);
    const deposited = inPeriod.reduce((s, d) => s + d.amount, 0);
    const endValue = points[point];
    const profit = endValue - prevValue - deposited;
    const base = prevValue + deposited;
    years.push({
      year: point.slice(0, 4),
      isYTD: point === today,
      periodStart: prevDate,
      periodEnd: point,
      startValue: prevValue,
      deposited,
      endValue,
      profit,
      simplePct: base > 0 ? (profit / base) * 100 : null,
    });
    prevDate = point;
    prevValue = endValue;
    first = false;
  }

  const totalDeposited = deposits.reduce((s, d) => s + d.amount, 0);
  const valueNow = points[today];
  const totalProfit = valueNow - totalDeposited;
  const rate = xirr([...deposits.map((d) => ({ t: toTime(d.date), c: -d.amount })), { t: toTime(today), c: valueNow }]);

  return {
    years,
    deposits,
    monthlyDeposits: groupByMonth(deposits, stmts.map((st) => st.asOf), today),
    cashByMonth,
    totalDeposited,
    valueNow,
    cashNow: cash,
    totalProfit,
    totalPct: totalDeposited > 0 ? (totalProfit / totalDeposited) * 100 : null,
    xirrPct: rate === null ? null : rate * 100,
    statementCount: stmts.length,
    lastStatement: stmts.length ? stmts[stmts.length - 1].asOf : null,
    mismatches,
    approxTickers: [...approx].sort(),
  };
}

/**
 * Money deposited per month. Up to the last statement each month comes from its statement
 * period, which is exact. When Dime skipped a statement, one period covers several months and
 * the cash on statements cannot tell them apart, so the period's amount is split evenly across
 * its months (`splitFrom`/`splitTo` say which). After the last statement the months hold
 * estimated deposits, until the next statement settles them.
 *
 * @returns [{ month: "YYYY-MM", amount, estimated, splitFrom?, splitTo? }]
 */
export function groupByMonth(deposits, statementDates, today) {
  const ends = [...statementDates].sort();
  const out = [];
  let prevEnd = null;
  for (const end of ends) {
    const inPeriod = deposits.filter((d) => (prevEnd === null || d.date > prevEnd) && d.date <= end);
    const firstMonth = prevEnd === null ? (inPeriod[0]?.date ?? end).slice(0, 7) : nextMonth(prevEnd.slice(0, 7));
    const months = [];
    for (let m = firstMonth; m <= end.slice(0, 7); m = nextMonth(m)) months.push(m);
    const amount = inPeriod.reduce((sum, d) => sum + d.amount, 0);
    for (const m of months) {
      const entry = { month: m, amount: amount / months.length, estimated: false };
      if (months.length > 1) Object.assign(entry, { splitFrom: months[0], splitTo: months[months.length - 1] });
      out.push(entry);
    }
    prevEnd = end;
  }
  const after = deposits.filter((d) => prevEnd === null || d.date > prevEnd);
  const byMonth = {};
  for (const d of after) byMonth[d.date.slice(0, 7)] = (byMonth[d.date.slice(0, 7)] || 0) + d.amount;
  // Months after the last statement with no deposit still get a bar, so a gap reads as "nothing
  // added" rather than as missing data.
  if (prevEnd !== null) for (let m = nextMonth(prevEnd.slice(0, 7)); m <= today.slice(0, 7); m = nextMonth(m)) byMonth[m] ??= 0;
  for (const m of Object.keys(byMonth).sort()) out.push({ month: m, amount: byMonth[m], estimated: true });
  // A statement period that starts before the first deposit (nothing in it) says nothing.
  while (out.length && out[0].amount === 0 && !out[0].estimated) out.shift();
  return out;
}

function nextMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

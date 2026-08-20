import { useState, useEffect, useMemo, useCallback } from "react";
import { Plus, Trash2, TrendingUp, TrendingDown, Wallet, Coins, RefreshCw, ChevronDown, ChevronUp, X, Eye, EyeOff } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, LabelList } from "recharts";

const FONT_LINK = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Noto+Sans+Thai:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";

const COLORS = {
  ink: "#10151C",
  ink2: "#171E27",
  panel: "#1B232E",
  panelLine: "#2A3441",
  paper: "#ECE6D8",
  muted: "#8792A0",
  gain: "#5FAE82",
  loss: "#C96456",
  gold: "#C9A24B",
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function fmt(n, digits = 2) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return n.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtSigned(n, digits = 2) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  const sign = n > 0 ? "+" : "";
  return sign + fmt(n, digits);
}

// Shown in place of any figure that would reveal position size while censoring is on.
// Censoring hides amounts and share counts but deliberately leaves percentages, tickers and
// dates visible -- a return of +18% says nothing about how much money is behind it. Share
// counts have to go too: quantity times the visible market price would rebuild the amount.
const MASK = "•••";

const EMPTY_TX = { date: "", ticker: "", type: "buy", qty: "", price: "", fee: "0" };

// Year-end closing prices, like everything else about this portfolio, come from a file.
const YEAR_END_PRICES_URL = "./year_end_prices.json";

const DIVIDENDS_URL = "./dividends.json";

// Buys and sells now come from the broker's own confirmation notes, imported by
// import_txs.py -- the numbers there are the broker's, down to the seventh decimal and
// including the per-trade fees that the old hardcoded list left at zero. Trades that no
// confirmation note covers live in the manual file alongside the dividends.
const TRANSACTIONS_URL = "./transactions.json";
const MANUAL_TX_URL = "./manual_transactions.json";

async function fetchRows(url, keep) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const raw = await res.json();
    const list = Array.isArray(raw) ? raw : raw.transactions;
    if (!Array.isArray(list)) return null;
    return list.filter((t) => t && t.id && (!keep || keep(t)));
  } catch (e) {
    return null;
  }
}

// Accepts either the current wrapped shape ({ fetched_at, prices }) or a bare { TICKER: price }
// map, which is what older versions of get_prices.py wrote. Non-numeric entries are dropped
// rather than allowed through as NaN, which would silently poison every downstream total.
function parsePricesFile(raw) {
  if (!raw || typeof raw !== "object") return null;
  const source = raw.prices && typeof raw.prices === "object" ? raw.prices : raw;
  const prices = {};
  for (const [ticker, value] of Object.entries(source)) {
    const n = parseFloat(value);
    if (isFinite(n) && n > 0) prices[ticker.toUpperCase()] = n;
  }
  if (Object.keys(prices).length === 0) return null;
  return { prices, fetchedAt: typeof raw.fetched_at === "string" ? raw.fetched_at : null };
}

export default function PortfolioDashboard() {
  const [txs, setTxs] = useState([]);
  const [prices, setPrices] = useState({});
  const [yearEndPrices, setYearEndPrices] = useState({}); // { "2025": { AAPL: 100.0, ... }, ... }
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(EMPTY_TX);
  const [showForm, setShowForm] = useState(false);
  const [showLog, setShowLog] = useState(true);
  const [error, setError] = useState("");
  const [savingNote, setSavingNote] = useState("");
  const [priceSource, setPriceSource] = useState(null); // { label, fetchedAt } once prices.json is read
  const [hideAmounts, setHideAmounts] = useState(false);
  // Years whose closing prices came from the file need no input UI.
  const [yearEndFromFile, setYearEndFromFile] = useState({});

  // Bump this whenever the canonical row set changes shape, so every browser reconciles to
  // the files instead of holding on to rows from an earlier version of this dashboard --
  // version 5 is the move off the hardcoded list onto the broker's own confirmation notes.
  const SEED_RECONCILE_VERSION = "5";

  // load from storage, reconciling against the canonical seed list by fixed id
  useEffect(() => {
    (async () => {
      let existing = [];
      try {
        const t = await window.storage.get("transactions");
        if (t && t.value) existing = JSON.parse(t.value);
      } catch (e) {}

      let seedVersion = null;
      try {
        const v = await window.storage.get("seed-version");
        if (v && v.value) seedVersion = v.value;
      } catch (e) {}

      // The canonical list is now three files, and reconciling against a partial copy of it
      // would delete whatever failed to load. So all three have to arrive before anything is
      // dropped; if any is missing, storage is left exactly as it is.
      const [importedRows, dividendRows, manualRows] = await Promise.all([
        fetchRows(TRANSACTIONS_URL),
        fetchRows(DIVIDENDS_URL, (t) => t.type === "dividend"),
        fetchRows(MANUAL_TX_URL),
      ]);
      const filesLoaded = importedRows !== null && dividendRows !== null && manualRows !== null;

      const allSeed = filesLoaded ? [...importedRows, ...dividendRows, ...manualRows] : [];
      let finalTxs;
      let needsSave = false;

      if (seedVersion !== SEED_RECONCILE_VERSION && filesLoaded) {
        // Full reconciliation: drop anything that looks like an old/duplicate seed entry
        // (random-id rows from before fixed ids existed, or stale seed ids), keep only
        // genuinely user-added rows (ids starting with "u-"), then re-add the canonical seed.
        const userAdded = existing.filter((t) => typeof t.id === "string" && t.id.startsWith("u-"));
        finalTxs = [...allSeed, ...userAdded];
        needsSave = true;
      } else {
        // Already reconciled, or the files are unreachable: keep what is in storage and top
        // up with any rows the files have gained since (a fresh import, a new dividend).
        const existingIds = new Set(existing.map((t) => t.id));
        const missing = allSeed.filter((t) => !existingIds.has(t.id));
        finalTxs = missing.length > 0 ? [...existing, ...missing] : existing;
        needsSave = missing.length > 0;
      }

      setTxs(finalTxs);
      if (needsSave) {
        try {
          await window.storage.set("transactions", JSON.stringify(finalTxs));
          await window.storage.set("seed-version", SEED_RECONCILE_VERSION);
        } catch (e) {}
      }

      // Prices: whatever the user typed stays, and prices.json overwrites the tickers it
      // covers -- it comes from get_prices.py and is by definition fresher. A missing or
      // malformed file leaves the stored prices untouched rather than blanking them.
      let existingPrices = {};
      try {
        const p = await window.storage.get("current-prices");
        if (p && p.value) existingPrices = JSON.parse(p.value);
      } catch (e) {}

      let fromFile = null;
      try {
        const res = await fetch(PRICES_URL, { cache: "no-store" });
        if (res.ok) fromFile = parsePricesFile(await res.json());
      } catch (e) {}

      const mergedPrices = fromFile ? { ...existingPrices, ...fromFile.prices } : existingPrices;
      setPrices(mergedPrices);
      if (fromFile) {
        setPriceSource({ label: "prices.json", fetchedAt: fromFile.fetchedAt });
        try {
          await window.storage.set("current-prices", JSON.stringify(mergedPrices));
        } catch (e) {}
      }

      // Year-end prices work the same way: the file fills in years and tickers the user has
      // not entered by hand, and never overwrites one that was.
      let yearEndFromFile = {};
      try {
        const res = await fetch(YEAR_END_PRICES_URL, { cache: "no-store" });
        if (res.ok) {
          const raw = await res.json();
          const years = raw && raw.years ? raw.years : raw;
          if (years && typeof years === "object") yearEndFromFile = years;
        }
      } catch (e) {}

      let existingYearEndPrices = {};
      try {
        const yep = await window.storage.get("year-end-prices");
        if (yep && yep.value) existingYearEndPrices = JSON.parse(yep.value);
      } catch (e) {}

      let yepChanged = false;
      const mergedYearEndPrices = { ...existingYearEndPrices };
      for (const [year, tickerPrices] of Object.entries(yearEndFromFile)) {
        mergedYearEndPrices[year] = mergedYearEndPrices[year] || {};
        for (const [ticker, price] of Object.entries(tickerPrices)) {
          if (mergedYearEndPrices[year][ticker] === undefined) {
            mergedYearEndPrices[year][ticker] = price;
            yepChanged = true;
          }
        }
      }
      setYearEndPrices(mergedYearEndPrices);
      setYearEndFromFile(yearEndFromFile);
      if (yepChanged) {
        try {
          await window.storage.set("year-end-prices", JSON.stringify(mergedYearEndPrices));
        } catch (e) {}
      }

      try {
        const h = await window.storage.get("hide-amounts");
        if (h && h.value === "1") setHideAmounts(true);
      } catch (e) {}

      setLoaded(true);
    })();
  }, []);

  const persistTxs = useCallback(async (next) => {
    setTxs(next);
    try {
      await window.storage.set("transactions", JSON.stringify(next));
      setSavingNote("บันทึกแล้ว");
      setTimeout(() => setSavingNote(""), 1200);
    } catch (e) {
      setSavingNote("บันทึกไม่สำเร็จ");
    }
  }, []);

  const persistPrices = useCallback(async (next) => {
    setPrices(next);
    try {
      await window.storage.set("current-prices", JSON.stringify(next));
    } catch (e) {}
  }, []);

  const persistYearEndPrices = useCallback(async (next) => {
    setYearEndPrices(next);
    try {
      await window.storage.set("year-end-prices", JSON.stringify(next));
    } catch (e) {}
  }, []);

  const toggleHideAmounts = useCallback(async () => {
    const next = !hideAmounts;
    setHideAmounts(next);
    try {
      await window.storage.set("hide-amounts", next ? "1" : "0");
    } catch (e) {}
  }, [hideAmounts]);

  // Every figure that carries an amount goes through these, so switching censoring on cannot
  // miss a spot that formats a number by hand.
  const money = useCallback((n, digits = 2) => (hideAmounts ? MASK : fmt(n, digits) + "$"), [hideAmounts]);
  const moneySigned = useCallback((n, digits = 2) => (hideAmounts ? MASK : fmtSigned(n, digits) + "$"), [hideAmounts]);
  const shares = useCallback((n) => (hideAmounts ? MASK : fmt(n, n % 1 === 0 ? 0 : 2)), [hideAmounts]);

  const addTx = () => {
    setError("");
    if (!form.date || !form.ticker || !form.qty || (form.type !== "dividend" && !form.price)) {
      setError("กรอกข้อมูลให้ครบ: วันที่, หุ้น, จำนวน" + (form.type !== "dividend" ? ", ราคา" : ""));
      return;
    }
    const ticker = form.ticker.trim().toUpperCase();
    const newTx = {
      id: "u-" + uid(),
      date: form.date,
      ticker,
      type: form.type,
      qty: parseFloat(form.qty) || 0,
      price: form.type === "dividend" ? 0 : parseFloat(form.price) || 0,
      fee: parseFloat(form.fee) || 0,
      // for dividend: qty field holds the total USD received
    };
    const next = [...txs, newTx].sort((a, b) => a.date.localeCompare(b.date));
    persistTxs(next);
    setForm({ ...EMPTY_TX, ticker: "" });
    setShowForm(false);
  };

  const deleteTx = (id) => {
    persistTxs(txs.filter((t) => t.id !== id));
  };

  // core portfolio math: weighted average cost method
  const holdings = useMemo(() => {
    const byTicker = {};
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    for (const t of sorted) {
      if (!byTicker[t.ticker]) {
        byTicker[t.ticker] = {
          ticker: t.ticker,
          qty: 0,
          costBasis: 0,
          totalInvested: 0,
          firstBuyDate: null,
          lastActivityDate: null,
          realizedPL: 0,
          dividends: 0,
          buyCount: 0,
          sellCount: 0,
        };
      }
      const h = byTicker[t.ticker];
      h.lastActivityDate = t.date;
      if (t.type === "buy") {
        h.qty += t.qty;
        h.costBasis += t.qty * t.price + t.fee;
        h.totalInvested += t.qty * t.price + t.fee;
        if (!h.firstBuyDate) h.firstBuyDate = t.date;
        h.buyCount += 1;
      } else if (t.type === "sell") {
        const avgCost = h.qty > 0 ? h.costBasis / h.qty : 0;
        const sellQty = Math.min(t.qty, h.qty);
        const proceeds = sellQty * t.price - t.fee;
        const costOfSold = sellQty * avgCost;
        h.realizedPL += proceeds - costOfSold;
        h.costBasis -= costOfSold;
        h.qty -= sellQty;
        h.sellCount += 1;
      } else if (t.type === "dividend") {
        h.dividends += t.qty; // qty field = amount received in USD for dividend rows
      }
    }
    return Object.values(byTicker);
  }, [txs]);

  const rows = useMemo(() => {
    return holdings
      .map((h) => {
        const avgCost = h.qty > 0 ? h.costBasis / h.qty : 0;
        const currentPrice = prices[h.ticker] !== undefined ? parseFloat(prices[h.ticker]) : null;
        const currentValue = currentPrice !== null ? currentPrice * h.qty : null;
        const unrealizedPL = currentPrice !== null ? currentValue - h.costBasis : null;
        const unrealizedPct = currentPrice !== null && h.costBasis > 0 ? (unrealizedPL / h.costBasis) * 100 : null;
        return { ...h, avgCost, currentPrice, currentValue, unrealizedPL, unrealizedPct };
      })
      .sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [holdings, prices]);

  const totals = useMemo(() => {
    let costBasis = 0,
      currentValue = 0,
      hasAllPrices = true,
      unrealizedPL = 0,
      realizedPL = 0,
      dividends = 0;
    for (const r of rows) {
      if (r.qty > 0) {
        costBasis += r.costBasis;
        if (r.currentValue !== null) {
          currentValue += r.currentValue;
          unrealizedPL += r.unrealizedPL;
        } else {
          hasAllPrices = false;
        }
      }
      realizedPL += r.realizedPL;
      dividends += r.dividends;
    }
    return { costBasis, currentValue, unrealizedPL, realizedPL, dividends, hasAllPrices, totalReturn: unrealizedPL + realizedPL + dividends };
  }, [rows]);

  const tickerTape = rows.filter((r) => r.qty > 0);

  const activeRows = rows.filter((r) => r.qty > 0.0000001);
  const closedRows = rows.filter((r) => r.qty <= 0.0000001 && (r.realizedPL !== 0 || r.dividends !== 0));

  const sortedTxLog = useMemo(() => [...txs].sort((a, b) => b.date.localeCompare(a.date)), [txs]);

  // --- Annualized return per ticker (simple holding-period annualization) ---
  // For each ticker: totalReturn = realized P/L + dividends + unrealized P/L (if priced).
  // Annualized using days since first buy of that ticker through today.
  const TODAY = new Date().toISOString().slice(0, 10);
  const annualReturns = useMemo(() => {
    return rows
      .filter((r) => r.totalInvested > 0 && r.firstBuyDate)
      .map((r) => {
        const unrealized = r.qty > 0 && r.currentPrice !== null ? r.currentPrice * r.qty - r.costBasis : 0;
        const hasUnknownValue = r.qty > 0 && r.currentPrice === null;
        const totalGain = r.realizedPL + r.dividends + unrealized;
        const endDate = r.qty > 0 ? TODAY : r.lastActivityDate;
        const days = Math.max(1, (new Date(endDate) - new Date(r.firstBuyDate)) / (1000 * 60 * 60 * 24));
        const totalReturnPct = (totalGain / r.totalInvested) * 100;
        // Short holding periods make annualizing (extrapolating to a full year) unstable/misleading,
        // so below ~14 days we show the plain total return instead of an annualized figure.
        const isShortHold = days < 14;
        // Simple (linear) annualization avoids the extreme blow-ups that geometric/compounded
        // annualizing produces for short holding periods (raising a small daily move to the
        // power of ~365 can turn a modest loss into "-100%" or a modest gain into "+50,000%").
        let annualizedPct = isShortHold ? totalReturnPct : totalReturnPct * (365 / days);
        // Cap purely for chart readability; the tooltip still shows the exact figure.
        const capped = Math.abs(annualizedPct) > 500;
        if (capped) annualizedPct = Math.sign(annualizedPct) * 500;
        return { ticker: r.ticker, annualizedPct, totalReturnPct, totalGain, days, hasUnknownValue, isShortHold, capped };
      })
      .sort((a, b) => b.annualizedPct - a.annualizedPct);
  }, [rows, TODAY]);

  // Per-calendar-year return: realized gains + dividends booked in that year, relative to
  // capital deployed (buys) that same year. Computed purely from transaction records (no need
  // for historical market prices), so it only reflects realized income, not unrealized/paper gains
  // on positions still held. The current year is also shown annualized (simple/linear) based on
  // how much of the year has elapsed, since it's not over yet.
  // Per-calendar-year TOTAL return: realized gains + dividends booked in that year, PLUS the
  // change in unrealized P&L over the year (unrealized P&L at year-end minus unrealized P&L at
  // the start of the year) so appreciation already counted in an earlier year isn't counted again.
  // Year-end valuations use user-supplied Dec 31 prices (yearEndPrices); the current year uses
  // today's live prices since it isn't over yet.
  const yearlyReturns = useMemo(() => {
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    const byTicker = {};
    const yearData = {};
    const years = [];
    for (const t of sorted) {
      const year = t.date.slice(0, 4);
      if (!yearData[year]) {
        yearData[year] = { capitalDeployed: 0, realizedGain: 0, dividends: 0 };
        years.push(year);
      }
      if (!byTicker[t.ticker]) byTicker[t.ticker] = { qty: 0, costBasis: 0 };
      const h = byTicker[t.ticker];
      if (t.type === "buy") {
        const cost = t.qty * t.price + t.fee;
        h.qty += t.qty;
        h.costBasis += cost;
        yearData[year].capitalDeployed += cost;
      } else if (t.type === "sell") {
        const avgCost = h.qty > 0 ? h.costBasis / h.qty : 0;
        const sellQty = Math.min(t.qty, h.qty);
        const proceeds = sellQty * t.price - t.fee;
        const costOfSold = sellQty * avgCost;
        yearData[year].realizedGain += proceeds - costOfSold;
        h.costBasis -= costOfSold;
        h.qty -= sellQty;
      } else if (t.type === "dividend") {
        yearData[year].dividends += t.qty;
      }
    }

    // Replay again, this time snapshotting qty/costBasis at each year-end cutoff so we can value
    // holdings with that year's closing prices.
    const holdingsAsOf = (cutoffDate) => {
      const snap = {};
      for (const t of sorted) {
        if (t.date > cutoffDate) break;
        if (!snap[t.ticker]) snap[t.ticker] = { qty: 0, costBasis: 0 };
        const h = snap[t.ticker];
        if (t.type === "buy") {
          h.qty += t.qty;
          h.costBasis += t.qty * t.price + t.fee;
        } else if (t.type === "sell") {
          const avgCost = h.qty > 0 ? h.costBasis / h.qty : 0;
          const sellQty = Math.min(t.qty, h.qty);
          h.costBasis -= sellQty * avgCost;
          h.qty -= sellQty;
        }
      }
      return snap;
    };

    const nowYear = TODAY.slice(0, 4);
    const sortedYears = [...years].sort();
    let prevUnrealized = 0;
    let prevHadFullCoverage = true;
    let prevCostBasisTotal = 0;

    return sortedYears.map((year) => {
      const d = yearData[year];
      const isYTD = year === nowYear;
      const cutoff = isYTD ? TODAY : `${year}-12-31`;
      const priceMap = isYTD ? prices : yearEndPrices[year] || {};
      const snap = holdingsAsOf(cutoff);

      let unrealizedAtYearEnd = 0;
      let costBasisTotal = 0;
      let fullCoverage = true;
      const missingTickers = [];
      for (const [ticker, h] of Object.entries(snap)) {
        if (h.qty <= 1e-7) continue;
        costBasisTotal += h.costBasis;
        const p = priceMap[ticker];
        if (p === undefined || p === "" || isNaN(parseFloat(p))) {
          fullCoverage = false;
          missingTickers.push(ticker);
          continue;
        }
        unrealizedAtYearEnd += parseFloat(p) * h.qty - h.costBasis;
      }

      const unrealizedGainInYear = fullCoverage && prevHadFullCoverage ? unrealizedAtYearEnd - prevUnrealized : null;
      const totalGain = d.realizedGain + d.dividends + (unrealizedGainInYear || 0);
      // Denominator = capital that was "in the market" at some point during the year: what was
      // already invested coming into the year, plus whatever new capital was deployed this year.
      // This intentionally does NOT shrink when a position is sold, so — matching how a simple
      // "return on my original cost" should work — a holding bought for 100 that's worth 150 at
      // year-end and 200 today shows 50% for each of those two years, not a shrinking base.
      const denominator = prevCostBasisTotal + d.capitalDeployed;
      const simplePct = denominator > 0 ? (totalGain / denominator) * 100 : null;
      let annualizedPct = simplePct;
      if (isYTD && simplePct !== null) {
        const daysElapsed = Math.max(1, (new Date(TODAY) - new Date(`${year}-01-01`)) / (1000 * 60 * 60 * 24));
        annualizedPct = simplePct * (365 / daysElapsed);
      }

      prevUnrealized = fullCoverage ? unrealizedAtYearEnd : prevUnrealized;
      prevHadFullCoverage = fullCoverage;
      prevCostBasisTotal = costBasisTotal;

      return {
        year,
        simplePct,
        annualizedPct,
        isYTD,
        unrealizedGainInYear,
        missingTickers,
        needsYearEndPrices: !isYTD && missingTickers.length > 0,
        ...d,
      };
    });
  }, [txs, prices, yearEndPrices, TODAY]);

  // Which tickers were held at the end of each PAST (non-current) year, for the year-end price inputs.
  const yearEndHoldingsNeeded = useMemo(() => {
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    const nowYear = TODAY.slice(0, 4);
    const years = [...new Set(sorted.map((t) => t.date.slice(0, 4)))]
      .filter((y) => y !== nowYear && !yearEndFromFile[y])
      .sort();
    const result = {};
    for (const year of years) {
      const cutoff = `${year}-12-31`;
      const snap = {};
      for (const t of sorted) {
        if (t.date > cutoff) break;
        if (!snap[t.ticker]) snap[t.ticker] = { qty: 0, costBasis: 0 };
        const h = snap[t.ticker];
        if (t.type === "buy") {
          h.qty += t.qty;
          h.costBasis += t.qty * t.price + t.fee;
        } else if (t.type === "sell") {
          const avgCost = h.qty > 0 ? h.costBasis / h.qty : 0;
          const sellQty = Math.min(t.qty, h.qty);
          h.costBasis -= sellQty * avgCost;
          h.qty -= sellQty;
        }
      }
      const tickers = Object.keys(snap).filter((t) => snap[t].qty > 1e-7);
      if (tickers.length > 0) result[year] = tickers;
    }
    return result;
  }, [txs, TODAY, yearEndFromFile]);

  // Overall portfolio money-weighted annualized return (XIRR) across all cash flows.
  const portfolioXIRR = useMemo(() => {
    if (txs.length === 0) return null;
    const flows = [];
    for (const t of txs) {
      if (t.type === "buy") flows.push({ date: t.date, amount: -(t.qty * t.price + t.fee) });
      else if (t.type === "sell") flows.push({ date: t.date, amount: t.qty * t.price - t.fee });
      else if (t.type === "dividend") flows.push({ date: t.date, amount: t.qty });
    }
    if (totals.currentValue > 0) flows.push({ date: TODAY, amount: totals.currentValue });
    flows.sort((a, b) => a.date.localeCompare(b.date));
    if (flows.length < 2) return null;
    const t0 = new Date(flows[0].date).getTime();
    const yrs = flows.map((f) => (new Date(f.date).getTime() - t0) / (365 * 24 * 60 * 60 * 1000));
    const npv = (rate) => flows.reduce((sum, f, i) => sum + f.amount / Math.pow(1 + rate, yrs[i]), 0);
    const dnpv = (rate) => flows.reduce((sum, f, i) => sum - (yrs[i] * f.amount) / Math.pow(1 + rate, yrs[i] + 1), 0);
    let rate = 0.15;
    for (let i = 0; i < 200; i++) {
      const f = npv(rate);
      const df = dnpv(rate);
      if (Math.abs(df) < 1e-9) break;
      let next = rate - f / df;
      if (!isFinite(next) || next <= -0.999) next = rate / 2;
      if (Math.abs(next - rate) < 1e-8) {
        rate = next;
        break;
      }
      rate = next;
    }
    return rate * 100;
  }, [txs, totals.currentValue, TODAY]);

  // --- Portfolio growth over time (cost-basis based, since we don't have historical market prices) ---
  const growthSeries = useMemo(() => {
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length === 0) return [];
    const byTickerRunning = {};
    let cumCostBasis = 0;
    let cumRealizedAndDividends = 0;
    const points = [];
    for (const t of sorted) {
      if (!byTickerRunning[t.ticker]) byTickerRunning[t.ticker] = { qty: 0, costBasis: 0 };
      const h = byTickerRunning[t.ticker];
      if (t.type === "buy") {
        h.qty += t.qty;
        h.costBasis += t.qty * t.price + t.fee;
        cumCostBasis += t.qty * t.price + t.fee;
      } else if (t.type === "sell") {
        const avgCost = h.qty > 0 ? h.costBasis / h.qty : 0;
        const sellQty = Math.min(t.qty, h.qty);
        const costOfSold = sellQty * avgCost;
        const proceeds = sellQty * t.price - t.fee;
        cumCostBasis -= costOfSold;
        cumRealizedAndDividends += proceeds - costOfSold;
        h.costBasis -= costOfSold;
        h.qty -= sellQty;
      } else if (t.type === "dividend") {
        cumRealizedAndDividends += t.qty;
      }
      points.push({
        date: t.date,
        costBasis: Math.round(cumCostBasis * 100) / 100,
        realizedAndDividends: Math.round(cumRealizedAndDividends * 100) / 100,
        total: Math.round((cumCostBasis + cumRealizedAndDividends) * 100) / 100,
      });
    }
    // collapse to one point per month (last value of that month) for a cleaner chart
    const byMonth = {};
    for (const p of points) byMonth[p.date.slice(0, 7)] = p;
    return Object.entries(byMonth)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, p]) => ({ month, ...p }));
  }, [txs]);

  return (
    <div
      style={{
        fontFamily: "'Noto Sans Thai', sans-serif",
        background: COLORS.ink,
        color: COLORS.paper,
        minHeight: "100%",
        padding: "0",
        borderRadius: "12px",
        overflow: "hidden",
      }}
    >
      <style>{`
        @import url('${FONT_LINK}');
        .pf-display { font-family: 'Fraunces', serif; }
        .pf-mono { font-family: 'IBM Plex Mono', monospace; }
        .pf-scroll::-webkit-scrollbar { height: 6px; width: 6px; }
        .pf-scroll::-webkit-scrollbar-thumb { background: ${COLORS.panelLine}; border-radius: 3px; }
        @keyframes pf-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .pf-tape-track {
          display: inline-flex;
          animation: pf-marquee 28s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .pf-tape-track { animation: none; }
        }
        .pf-input {
          background: ${COLORS.ink2};
          border: 1px solid ${COLORS.panelLine};
          color: ${COLORS.paper};
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 13px;
          outline: none;
          width: 100%;
        }
        .pf-input:focus { border-color: ${COLORS.gold}; }
        .pf-btn {
          background: ${COLORS.gold};
          color: ${COLORS.ink};
          border: none;
          border-radius: 6px;
          padding: 9px 16px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .pf-btn:hover { filter: brightness(1.08); }
        .pf-btn-ghost {
          background: transparent;
          color: ${COLORS.muted};
          border: 1px solid ${COLORS.panelLine};
          border-radius: 6px;
          padding: 9px 14px;
          font-size: 13px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .pf-btn-ghost:hover { color: ${COLORS.paper}; border-color: ${COLORS.muted}; }
        .pf-table th { text-align: left; font-weight: 500; color: ${COLORS.muted}; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; padding: 8px 12px; border-bottom: 1px solid ${COLORS.panelLine}; }
        .pf-table td { padding: 10px 12px; border-bottom: 1px solid ${COLORS.ink2}; font-size: 13.5px; }
        .pf-table tr:hover td { background: ${COLORS.ink2}; }
      `}</style>

      {/* Ticker tape - signature element */}
      <div
        style={{
          background: COLORS.ink2,
          borderBottom: `1px solid ${COLORS.panelLine}`,
          overflow: "hidden",
          whiteSpace: "nowrap",
          padding: "9px 0",
        }}
      >
        {tickerTape.length === 0 ? (
          <div className="pf-mono" style={{ color: COLORS.muted, fontSize: 12, padding: "0 16px" }}>
            ยังไม่มีหุ้นในพอร์ต — เพิ่มรายการซื้อขายเพื่อเริ่มติดตาม
          </div>
        ) : (
          <div className="pf-tape-track">
            {[...tickerTape, ...tickerTape].map((r, i) => (
              <span
                key={i}
                className="pf-mono"
                style={{ padding: "0 20px", fontSize: 12.5, color: COLORS.muted, display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <b style={{ color: COLORS.paper }}>{r.ticker}</b>
                {r.currentPrice !== null ? (
                  <span style={{ color: r.unrealizedPL >= 0 ? COLORS.gain : COLORS.loss }}>
                    {money(r.currentPrice)} ({fmtSigned(r.unrealizedPct, 1)}%)
                  </span>
                ) : (
                  <span style={{ color: COLORS.muted }}>ยังไม่ระบุราคา</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "22px 22px 28px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="pf-mono" style={{ color: COLORS.gold, fontSize: 11, letterSpacing: "0.12em", marginBottom: 4 }}>
              PORTFOLIO LEDGER
            </div>
            <div className="pf-display" style={{ fontSize: 26, fontWeight: 600 }}>
              สมุดพอร์ตหุ้นของฉัน
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {priceSource && (
              <span className="pf-mono" style={{ fontSize: 11, color: COLORS.muted }}>
                ราคาจาก {priceSource.label}
                {priceSource.fetchedAt ? ` · ${priceSource.fetchedAt.slice(0, 16).replace("T", " ")}` : ""}
              </span>
            )}
            {savingNote && <span style={{ fontSize: 11.5, color: COLORS.muted }}>{savingNote}</span>}
            <button
              className="pf-btn-ghost"
              onClick={toggleHideAmounts}
              title={hideAmounts ? "แสดงยอดเงิน" : "ซ่อนยอดเงิน"}
              aria-pressed={hideAmounts}
            >
              {hideAmounts ? <EyeOff size={15} /> : <Eye size={15} />} {hideAmounts ? "ซ่อนอยู่" : "ซ่อนยอด"}
            </button>
            <button className="pf-btn" onClick={() => setShowForm((s) => !s)}>
              <Plus size={15} /> เพิ่มรายการ
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 22 }}>
          <SummaryCard icon={<Wallet size={15} />} label="ต้นทุนคงเหลือ" value={money(totals.costBasis, 0)} />
          <SummaryCard
            icon={<Coins size={15} />}
            label="มูลค่าปัจจุบัน"
            value={totals.hasAllPrices || totals.currentValue > 0 ? money(totals.currentValue, 0) : "รอราคา"}
            sub={!totals.hasAllPrices ? "บางตัวยังไม่ใส่ราคา" : undefined}
          />
          <SummaryCard
            icon={totals.unrealizedPL >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
            label="กำไร/ขาดทุน (ยังไม่ขาย)"
            value={moneySigned(totals.unrealizedPL, 0)}
            color={totals.unrealizedPL >= 0 ? COLORS.gain : COLORS.loss}
          />
          <SummaryCard
            label="กำไรที่ขายแล้ว"
            value={moneySigned(totals.realizedPL, 0)}
            color={totals.realizedPL >= 0 ? COLORS.gain : COLORS.loss}
          />
          <SummaryCard label="ปันผลรวม" value={money(totals.dividends, 0)} color={COLORS.gold} />
          <SummaryCard
            label="ผลตอบแทนรวมทั้งหมด"
            value={moneySigned(totals.totalReturn, 0)}
            color={totals.totalReturn >= 0 ? COLORS.gain : COLORS.loss}
            emphasize
          />
        </div>

        <IngestPanel />

        {error && (
          <div style={{ background: "#2A1A1A", border: `1px solid ${COLORS.loss}`, color: COLORS.loss, padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 14 }}>
            {error}
          </div>
        )}

        {/* Add transaction form */}
        {showForm && (
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.panelLine}`, borderRadius: 10, padding: 16, marginBottom: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <div className="pf-display" style={{ fontSize: 15, fontWeight: 600 }}>
                เพิ่มรายการซื้อ / ขาย / ปันผล
              </div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", color: COLORS.muted, cursor: "pointer" }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
              <Field label="วันที่">
                <input type="date" className="pf-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </Field>
              <Field label="สัญลักษณ์หุ้น">
                <input className="pf-input" placeholder="เช่น PTT" value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })} />
              </Field>
              <Field label="ประเภท">
                <select className="pf-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="buy">ซื้อ</option>
                  <option value="sell">ขาย</option>
                  <option value="dividend">ปันผล</option>
                </select>
              </Field>
              <Field label={form.type === "dividend" ? "จำนวนเงินที่ได้รับ (USD)" : "จำนวนหุ้น"}>
                <input type="number" className="pf-input" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
              </Field>
              {form.type !== "dividend" && (
                <Field label="ราคาต่อหุ้น">
                  <input type="number" className="pf-input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                </Field>
              )}
              {form.type !== "dividend" && (
                <Field label="ค่าธรรมเนียม (USD)">
                  <input type="number" className="pf-input" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
                </Field>
              )}
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="pf-btn" onClick={addTx}>
                <Plus size={15} /> บันทึกรายการ
              </button>
            </div>
          </div>
        )}

        {/* Charts: annualized return per ticker + portfolio growth over time */}
        {growthSeries.length > 1 && (
          <div style={{ marginBottom: 26 }}>
            <div className="pf-display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>
              การเติบโตของพอร์ต
            </div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 10 }}>
              เส้นทึบ = ต้นทุนที่ลงทุนอยู่สะสม (cost basis) · เส้นประ = กำไรสะสม (realized + ปันผล) — ยังไม่รวมมูลค่าตลาดปัจจุบันที่ผันผวนรายวัน
            </div>
            <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.panelLine}`, borderRadius: 10, padding: "14px 8px 6px" }}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={growthSeries} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.panelLine} vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: COLORS.muted, fontSize: 10.5 }} axisLine={{ stroke: COLORS.panelLine }} tickLine={false} />
                  <YAxis tick={{ fill: COLORS.muted, fontSize: 10.5 }} axisLine={false} tickLine={false} width={54} tickFormatter={(v) => (hideAmounts ? "" : fmt(v, 0) + "$")} />
                  <Tooltip
                    contentStyle={{ background: COLORS.ink2, border: `1px solid ${COLORS.panelLine}`, borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: COLORS.paper }}
                    formatter={(v, name) => [money(v, 0), name === "costBasis" ? "ต้นทุนคงเหลือสะสม" : "กำไรสะสม (realized+ปันผล)"]}
                  />
                  <ReferenceLine y={0} stroke={COLORS.panelLine} />
                  <Line type="monotone" dataKey="costBasis" stroke={COLORS.gold} strokeWidth={2} dot={false} name="costBasis" />
                  <Line type="monotone" dataKey="realizedAndDividends" stroke={COLORS.gain} strokeWidth={2} strokeDasharray="4 3" dot={false} name="realizedAndDividends" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {yearlyReturns.length > 0 && (
          <div style={{ marginBottom: 26 }}>
            <div className="pf-display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>
              ผลตอบแทนรายปี — ปีนี้คุณได้เท่าไหร่
            </div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 10 }}>
              กำไรที่ขายจริง + ปันผล + การเปลี่ยนแปลงของกำไร/ขาดทุนที่ยังไม่ขาย (เทียบราคาปิดสิ้นปีก่อนหน้ากับสิ้นปีนี้ ไม่นับซ้ำข้ามปี) เทียบกับเงินลงทุนที่ใส่เข้าไปในปีนั้น — ปีปัจจุบันแปลงเป็นอัตราเทียบเท่ารายปีตามสัดส่วนวันที่ผ่านมาแล้ว
            </div>
            <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.panelLine}`, borderRadius: 10, padding: "14px 8px 6px" }}>
              <ResponsiveContainer width="100%" height={Math.max(120, yearlyReturns.length * 50)}>
                <BarChart data={yearlyReturns} layout="vertical" margin={{ top: 5, right: 50, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.panelLine} horizontal={false} />
                  <XAxis type="number" tick={{ fill: COLORS.muted, fontSize: 10.5 }} axisLine={{ stroke: COLORS.panelLine }} tickLine={false} tickFormatter={(v) => v + "%"} />
                  <YAxis
                    type="category"
                    dataKey="year"
                    tick={{ fill: COLORS.paper, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                    tickFormatter={(y) => (y === TODAY.slice(0, 4) ? y + " (YTD)" : y)}
                  />
                  <Tooltip
                    contentStyle={{ background: COLORS.ink2, border: `1px solid ${COLORS.panelLine}`, borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: COLORS.paper }}
                    formatter={(v, name, props) => {
                      const p = props.payload;
                      const lines = [fmtSigned(p.annualizedPct, 1) + "%" + (p.isYTD ? " (เทียบเท่ารายปี)" : "")];
                      if (p.isYTD) lines.push(`ตามจริง ณ วันนี้: ${fmtSigned(p.simplePct, 1)}%`);
                      if (p.needsYearEndPrices) lines.push(`ยังไม่รวม unrealized — ขาดราคาปิด: ${p.missingTickers.join(", ")}`);
                      return [lines.join(" · "), "ผลตอบแทน"];
                    }}
                  />
                  <ReferenceLine x={0} stroke={COLORS.panelLine} />
                  <Bar dataKey="annualizedPct" radius={[0, 4, 4, 0]}>
                    {yearlyReturns.map((r, i) => (
                      <Cell
                        key={i}
                        fill={r.annualizedPct >= 0 ? COLORS.gain : COLORS.loss}
                        fillOpacity={r.needsYearEndPrices ? 0.4 : r.isYTD ? 0.75 : 1}
                      />
                    ))}
                    <LabelList
                      dataKey="annualizedPct"
                      position="right"
                      formatter={(v, entry) => fmtSigned(v, 1) + "%" + (entry && entry.needsYearEndPrices ? "*" : "")}
                      style={{ fill: COLORS.paper, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {Object.keys(yearEndHoldingsNeeded).length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COLORS.panelLine}` }}>
                  <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 8 }}>
                    * ยังไม่รวมกำไร/ขาดทุนที่ยังไม่ขายของปีนั้น เพราะขาดราคาปิด ณ 31 ธ.ค. — กรอกได้เลยครับ:
                  </div>
                  {Object.entries(yearEndHoldingsNeeded).map(([year, tickers]) => (
                    <div key={year} style={{ marginBottom: 8 }}>
                      <div className="pf-mono" style={{ fontSize: 11, color: COLORS.gold, marginBottom: 4 }}>
                        ราคาปิด 31 ธ.ค. {year}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {tickers.map((ticker) => (
                          <div key={ticker} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span className="pf-mono" style={{ fontSize: 12, color: COLORS.paper, width: 46 }}>
                              {ticker}
                            </span>
                            <input
                              type="number"
                              className="pf-input"
                              style={{ width: 82, padding: "5px 7px" }}
                              placeholder="ราคา"
                              value={(yearEndPrices[year] && yearEndPrices[year][ticker]) ?? ""}
                              onChange={(e) =>
                                persistYearEndPrices({
                                  ...yearEndPrices,
                                  [year]: { ...(yearEndPrices[year] || {}), [ticker]: e.target.value },
                                })
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {annualReturns.length > 0 && (
          <div style={{ marginBottom: 26 }}>
            <div className="pf-display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>
              อัตราผลตอบแทนเฉลี่ยต่อปี (annualized) ต่อหุ้น
            </div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 10 }}>
              คำนวณจากกำไรรวม (ขายจริง + ปันผล + กำไรที่ยังไม่รับรู้ถ้ามีราคา) เทียบกับเงินลงทุน แปลงเป็นอัตราต่อปีแบบเชิงเส้นตามระยะเวลาถือครองจริง (หุ้นที่ถือไม่ถึง 14 วันจะแสดงผลตอบแทนตามจริงโดยไม่ยืดเป็นรายปี เพื่อไม่ให้ตัวเลขบิดเบือน)
              {portfolioXIRR !== null && (
                <>
                  {" "}· ผลตอบแทนรวมทั้งพอร์ต (XIRR):{" "}
                  <b style={{ color: portfolioXIRR >= 0 ? COLORS.gain : COLORS.loss }}>{fmtSigned(portfolioXIRR, 1)}%/ปี</b>
                </>
              )}
            </div>
            <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.panelLine}`, borderRadius: 10, padding: "14px 8px 6px" }}>
              <ResponsiveContainer width="100%" height={Math.max(180, annualReturns.length * 30)}>
                <BarChart data={annualReturns} layout="vertical" margin={{ top: 5, right: 44, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.panelLine} horizontal={false} />
                  <XAxis type="number" tick={{ fill: COLORS.muted, fontSize: 10.5 }} axisLine={{ stroke: COLORS.panelLine }} tickLine={false} tickFormatter={(v) => v + "%"} />
                  <YAxis type="category" dataKey="ticker" tick={{ fill: COLORS.paper, fontSize: 12 }} axisLine={false} tickLine={false} width={50} />
                  <Tooltip
                    contentStyle={{ background: COLORS.ink2, border: `1px solid ${COLORS.panelLine}`, borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: COLORS.paper }}
                    formatter={(v, name, props) => {
                      const p = props.payload;
                      let label = fmtSigned(v, 1) + "%";
                      if (p.isShortHold) label += ` (ถือ ${Math.round(p.days)} วัน ยังไม่ยืดเป็นรายปี)`;
                      else if (p.capped) label += ` (ค่าจริงเกินขอบเขตกราฟ ถือแค่ ${Math.round(p.days)} วัน)`;
                      if (p.hasUnknownValue) label += " (ยังไม่ใส่ราคาปัจจุบัน)";
                      return [label, "ผลตอบแทนต่อปี"];
                    }}
                  />
                  <ReferenceLine x={0} stroke={COLORS.panelLine} />
                  <Bar dataKey="annualizedPct" radius={[0, 4, 4, 0]}>
                    {annualReturns.map((r, i) => (
                      <Cell key={i} fill={r.annualizedPct >= 0 ? COLORS.gain : COLORS.loss} fillOpacity={r.hasUnknownValue ? 0.45 : 1} />
                    ))}
                    <LabelList
                      dataKey="annualizedPct"
                      position="right"
                      formatter={(v, entry) => fmtSigned(v, 1) + "%" + (entry && entry.capped ? "*" : "")}
                      style={{ fill: COLORS.paper, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Holdings table */}
        <div className="pf-display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: COLORS.paper }}>
          หุ้นที่ถืออยู่
        </div>
        <div className="pf-scroll" style={{ overflowX: "auto", marginBottom: 26, border: `1px solid ${COLORS.panelLine}`, borderRadius: 10 }}>
          <table className="pf-table pf-mono" style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr>
                <th>หุ้น</th>
                <th>จำนวน</th>
                <th>ต้นทุนเฉลี่ย</th>
                <th>ราคาปัจจุบัน</th>
                <th>มูลค่าปัจจุบัน</th>
                <th>กำไร/ขาดทุน</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: COLORS.muted, textAlign: "center", padding: "20px 0", fontFamily: "'Noto Sans Thai', sans-serif" }}>
                    ยังไม่มีหุ้นถืออยู่ — กด "เพิ่มรายการ" เพื่อเริ่มบันทึก
                  </td>
                </tr>
              )}
              {activeRows.map((r) => (
                <tr key={r.ticker}>
                  <td style={{ color: COLORS.paper, fontWeight: 600 }}>{r.ticker}</td>
                  <td>{shares(r.qty)}</td>
                  <td>{money(r.avgCost)}</td>
                  <td>
                    <input
                      type="number"
                      className="pf-input"
                      style={{ width: 90, padding: "5px 7px" }}
                      placeholder="ใส่ราคา"
                      value={prices[r.ticker] ?? ""}
                      onChange={(e) => persistPrices({ ...prices, [r.ticker]: e.target.value })}
                    />
                  </td>
                  <td>{r.currentValue !== null ? money(r.currentValue, 0) : "-"}</td>
                  <td style={{ color: r.unrealizedPL === null ? COLORS.muted : r.unrealizedPL >= 0 ? COLORS.gain : COLORS.loss }}>
                    {r.unrealizedPL !== null ? moneySigned(r.unrealizedPL, 0) : "-"}
                  </td>
                  <td style={{ color: r.unrealizedPct === null ? COLORS.muted : r.unrealizedPct >= 0 ? COLORS.gain : COLORS.loss }}>
                    {r.unrealizedPct !== null ? fmtSigned(r.unrealizedPct, 1) + "%" : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {closedRows.length > 0 && (
          <>
            <div className="pf-display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
              หุ้นที่ปิดสถานะแล้ว
            </div>
            <div className="pf-scroll" style={{ overflowX: "auto", marginBottom: 26, border: `1px solid ${COLORS.panelLine}`, borderRadius: 10 }}>
              <table className="pf-table pf-mono" style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                <thead>
                  <tr>
                    <th>หุ้น</th>
                    <th>กำไรที่ขายแล้ว</th>
                    <th>ปันผลสะสม</th>
                  </tr>
                </thead>
                <tbody>
                  {closedRows.map((r) => (
                    <tr key={r.ticker}>
                      <td style={{ color: COLORS.paper, fontWeight: 600 }}>{r.ticker}</td>
                      <td style={{ color: r.realizedPL >= 0 ? COLORS.gain : COLORS.loss }}>{moneySigned(r.realizedPL, 0)}</td>
                      <td style={{ color: COLORS.gold }}>{r.dividends > 0 ? money(r.dividends, 0) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Transaction log */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, cursor: "pointer" }} onClick={() => setShowLog((s) => !s)}>
          <div className="pf-display" style={{ fontSize: 15, fontWeight: 600 }}>
            ประวัติรายการทั้งหมด ({txs.length})
          </div>
          {showLog ? <ChevronUp size={16} color={COLORS.muted} /> : <ChevronDown size={16} color={COLORS.muted} />}
        </div>
        {showLog && (
          <div className="pf-scroll" style={{ overflowX: "auto", border: `1px solid ${COLORS.panelLine}`, borderRadius: 10 }}>
            <table className="pf-table pf-mono" style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>หุ้น</th>
                  <th>ประเภท</th>
                  <th>จำนวน</th>
                  <th>ราคา</th>
                  <th>ค่าธรรมเนียม</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedTxLog.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ color: COLORS.muted, textAlign: "center", padding: "20px 0", fontFamily: "'Noto Sans Thai', sans-serif" }}>
                      ยังไม่มีรายการ
                    </td>
                  </tr>
                )}
                {sortedTxLog.map((t) => (
                  <tr key={t.id}>
                    <td>{t.date}</td>
                    <td style={{ color: COLORS.paper, fontWeight: 600 }}>{t.ticker}</td>
                    <td style={{ color: t.type === "buy" ? COLORS.gain : t.type === "sell" ? COLORS.loss : COLORS.gold }}>
                      {t.type === "buy" ? "ซื้อ" : t.type === "sell" ? "ขาย" : "ปันผล"}
                    </td>
                    <td>{t.type === "dividend" ? money(t.qty, 0) : shares(t.qty)}</td>
                    <td>{t.type === "dividend" ? "-" : money(t.price)}</td>
                    <td>{t.type === "dividend" ? "-" : money(t.fee, 0)}</td>
                    <td>
                      <button onClick={() => deleteTx(t.id)} style={{ background: "none", border: "none", color: COLORS.muted, cursor: "pointer" }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Talks to the local ingest API (server.py) through the dev server's /api proxy. When the
// API is not running -- the dashboard opened as a plain artifact, say -- every call fails
// and the panel hides itself rather than showing dead buttons.
function IngestPanel() {
  const [status, setStatus] = useState(null);
  const [job, setJob] = useState(null);
  const [authUrl, setAuthUrl] = useState(null);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error("api");
      setStatus(await res.json());
    } catch (e) {
      setStatus(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // While a job runs, poll it; when it finishes, reload so the dashboard picks up the
  // rows that were just written to disk.
  useEffect(() => {
    if (!job || job.state !== "running") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/job");
        const next = await res.json();
        setJob(next);
        if (next.state === "done") {
          setMessage("อัปเดตแล้ว กำลังโหลดหน้าใหม่");
          setTimeout(() => window.location.reload(), 800);
        } else if (next.state === "error") {
          setMessage("");
        }
      } catch (e) {}
    }, 1500);
    return () => clearInterval(timer);
  }, [job]);

  const post = async (path) => {
    setMessage("");
    try {
      const res = await fetch(path, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.error || "เรียกไม่สำเร็จ");
        return null;
      }
      return body;
    } catch (e) {
      setMessage("ต่อ API ไม่ได้");
      return null;
    }
  };

  const startSync = async () => {
    const body = await post("/api/sync");
    if (body) setJob({ state: "running", kind: "sync", log: [] });
  };

  const startPrices = async () => {
    const body = await post("/api/prices");
    if (body) setJob({ state: "running", kind: "prices", log: [] });
  };

  const startAuth = async () => {
    const body = await post("/api/auth/start");
    if (!body || !body.url) return;
    setAuthUrl(body.url);
    window.open(body.url, "_blank", "noopener");
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/auth/state");
        const state = await res.json();
        if (state.authorised) {
          clearInterval(timer);
          setAuthUrl(null);
          setMessage("เชื่อมต่อ Gmail แล้ว");
          refresh();
        } else if (state.state === "error") {
          clearInterval(timer);
          setMessage(state.error || "อนุญาตไม่สำเร็จ");
        }
      } catch (e) {}
    }, 2000);
  };

  if (status === null || status === false) return null;

  const running = job && job.state === "running";
  const counts = status.counts;

  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.panelLine}`, borderRadius: 10, padding: "12px 14px", marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: COLORS.muted, flex: 1, minWidth: 220 }}>
          {counts.transactions} รายการจากใบยืนยัน · {counts.dividends} ปันผล · {counts.manual} กรอกเอง
          {status.prices_fetched_at ? ` · ราคา ${status.prices_fetched_at.slice(0, 16).replace("T", " ")}` : ""}
        </div>

        {status.authorised ? (
          <button className="pf-btn" onClick={startSync} disabled={running}>
            <RefreshCw size={15} /> {running && job.kind === "sync" ? "กำลังดึง..." : "ดึงรายการใหม่จากเมล"}
          </button>
        ) : (
          <button className="pf-btn" onClick={startAuth} disabled={!status.client_configured}>
            <Eye size={15} /> เชื่อมต่อ Gmail
          </button>
        )}

        <button className="pf-btn-ghost" onClick={startPrices} disabled={running}>
          <Coins size={15} /> {running && job.kind === "prices" ? "กำลังอัปเดต..." : "อัปเดตราคา"}
        </button>
      </div>

      {!status.client_configured && (
        <div style={{ fontSize: 11.5, color: COLORS.loss, marginTop: 8 }}>
          ยังไม่มี credentials/oauth_client.json — สร้าง OAuth client แบบ Desktop app แล้ววางไฟล์ไว้ที่นั่น
        </div>
      )}

      {authUrl && (
        <div style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 8 }}>
          ถ้าหน้าต่างไม่เปิดขึ้นมา{" "}
          <a href={authUrl} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.gold }}>
            กดที่นี่เพื่ออนุญาต
          </a>
        </div>
      )}

      {message && <div style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 8 }}>{message}</div>}

      {job && job.error && (
        <pre className="pf-mono" style={{ fontSize: 11, color: COLORS.loss, marginTop: 8, whiteSpace: "pre-wrap" }}>{job.error}</pre>
      )}

      {job && job.log && job.log.length > 0 && (
        <pre
          className="pf-mono pf-scroll"
          style={{ fontSize: 11, color: COLORS.muted, marginTop: 8, maxHeight: 160, overflowY: "auto", whiteSpace: "pre-wrap" }}
        >
          {job.log.join("\n")}
        </pre>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, sub, color, emphasize }) {
  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${emphasize ? COLORS.gold : COLORS.panelLine}`,
        borderRadius: 10,
        padding: "12px 14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
        {icon}
        {label}
      </div>
      <div className="pf-mono" style={{ fontSize: 18, fontWeight: 600, color: color || COLORS.paper }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10.5, color: COLORS.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

import { useState, useEffect, useMemo, useCallback } from "react";
import { Plus, Trash2, TrendingUp, TrendingDown, Wallet, Coins, RefreshCw, ChevronDown, ChevronUp, X, Eye, EyeOff } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, LabelList } from "recharts";
import { api } from "./src/api";
import { useAuth } from "./src/auth";
import { portReturns } from "./src/returns";

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

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

// "2026-02" -> "ก.พ. 69"; a range of months in one bar reads "ก.พ.–มี.ค. 69".
function monthLabel(from, to) {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const year = (y) => String(y + 543).slice(2);
  if (from === to) return `${THAI_MONTHS[fm - 1]} ${year(fy)}`;
  if (fy === ty) return `${THAI_MONTHS[fm - 1]}–${THAI_MONTHS[tm - 1]} ${year(ty)}`;
  return `${THAI_MONTHS[fm - 1]} ${year(fy)}–${THAI_MONTHS[tm - 1]} ${year(ty)}`;
}

const EMPTY_TX = { date: "", ticker: "", type: "buy", qty: "", price: "", fee: "0" };

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
  const [priceSource, setPriceSource] = useState(null); // { label, fetchedAt } for the price banner
  const [hideAmounts, setHideAmounts] = useState(false);
  // Years the server already has closing prices for need no input UI.
  const [yearEndFromFile, setYearEndFromFile] = useState({});
  // Daily closes for the time-weighted yearly return: null while loading, "error" if the
  // fetch failed, in which case the yearly chart falls back to the cost-based figure.
  const [priceHistory, setPriceHistory] = useState(null);
  // Monthly statements from Dime, for the money deposited. Empty until a sync has fetched some.
  const [statements, setStatements] = useState([]);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillNote, setBackfillNote] = useState("");

  // Bump this whenever the canonical row set changes shape, so every browser reconciles to
  // the files instead of holding on to rows from an earlier version of this dashboard --
  // version 5 is the move off the hardcoded list onto the broker's own confirmation notes.
  const SEED_RECONCILE_VERSION = "5";

  // Everything about the portfolio comes from the API, which scopes every row to the
  // signed-in account. Nothing is read from disk and nothing is seeded into the browser.
  const load = useCallback(async () => {
    setError("");
    try {
      const [rows, priceData, yearEnd] = await Promise.all([api.transactions(), api.prices(), api.yearEndPrices()]);
      setTxs(rows);
      setPrices(priceData.prices);
      setPriceSource(priceData.fetchedAt ? { label: "ราคาตลาด", fetchedAt: priceData.fetchedAt } : null);
      setYearEndPrices(yearEnd);
      setYearEndFromFile(yearEnd);
      // Slow (it goes out to Yahoo), so it does not hold up the rest of the dashboard.
      api
        .priceHistory()
        .then(setPriceHistory)
        .catch(() => setPriceHistory("error"));
      api
        .statements()
        .then(setStatements)
        .catch(() => setStatements([]));
    } catch (e) {
      setError(e.message || "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();

    // Display preferences stay in the browser: they say nothing about the portfolio and
    // are per-device by nature.
    (async () => {
      try {
        const h = await window.storage.get("hide-amounts");
        if (h && h.value === "1") setHideAmounts(true);
      } catch (e) {}
    })();
  }, [load]);

  const persistPrices = useCallback(async (next, ticker) => {
    setPrices(next);
    const value = parseFloat(next[ticker]);
    if (!isFinite(value) || value <= 0) return;
    try {
      await api.setPrice(ticker, value);
      setSavingNote("บันทึกราคาแล้ว");
      setTimeout(() => setSavingNote(""), 1200);
    } catch (e) {
      setSavingNote("บันทึกราคาไม่สำเร็จ");
    }
  }, []);

  const persistYearEndPrices = useCallback(async (next, year, ticker) => {
    setYearEndPrices(next);
    const value = parseFloat(next[year]?.[ticker]);
    if (!isFinite(value) || value <= 0) return;
    try {
      await api.setYearEndPrice(ticker, year, value);
    } catch (e) {
      setSavingNote("บันทึกราคาปิดสิ้นปีไม่สำเร็จ");
    }
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

  // Year-end closes are market history, so they can be looked up rather than typed. Only
  // the gaps are filled: a figure already stored, including one entered by hand, is left.
  const backfillYearEnd = async () => {
    setBackfilling(true);
    setBackfillNote("");
    try {
      const result = await api.backfillYearEndPrices();
      const failed = result.failed?.length ? ` · ไม่พบราคา ${result.failed.join(", ")}` : "";
      setBackfillNote(result.filled > 0 ? `เติมราคาปิดสิ้นปีให้ ${result.filled} รายการ${failed}` : `ไม่มีรายการที่ต้องเติม${failed}`);
      await load();
    } catch (e) {
      setBackfillNote(e.message || "ดึงราคาปิดสิ้นปีไม่สำเร็จ");
    } finally {
      setBackfilling(false);
    }
  };

  const addTx = async () => {
    setError("");
    if (!form.date || !form.ticker || !form.qty || (form.type !== "dividend" && !form.price)) {
      setError("กรอกข้อมูลให้ครบ: วันที่, หุ้น, จำนวน" + (form.type !== "dividend" ? ", ราคา" : ""));
      return;
    }

    try {
      const created = await api.createTransaction({
        date: form.date,
        ticker: form.ticker.trim().toUpperCase(),
        type: form.type,
        // For a dividend this field carries the cash received, which the API stores as an
        // amount rather than as a share count.
        qty: parseFloat(form.qty) || 0,
        price: form.type === "dividend" ? 0 : parseFloat(form.price) || 0,
        fee: parseFloat(form.fee) || 0,
      });
      setTxs((current) => [...current, created].sort((a, b) => a.date.localeCompare(b.date)));
      setForm({ ...EMPTY_TX, ticker: "" });
      setShowForm(false);
      setSavingNote("บันทึกแล้ว");
      setTimeout(() => setSavingNote(""), 1200);
    } catch (e) {
      setError(e.message || "บันทึกไม่สำเร็จ");
    }
  };

  const deleteTx = async (id) => {
    setError("");
    try {
      await api.deleteTransaction(id);
      setTxs((current) => current.filter((t) => t.id !== id));
    } catch (e) {
      setError(e.message || "ลบไม่สำเร็จ");
    }
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

  // Per-calendar-year TOTAL return, measured against the capital that was actually at work.
  //
  // Numerator, per ticker: realized gains + dividends booked in the year, plus the change in
  // unrealized P&L over the year (unrealized at the end minus unrealized at the start) so that
  // appreciation already counted in an earlier year isn't counted again. A ticker whose price is
  // missing at either end contributes only its realized gains and dividends; it no longer wipes
  // out the unrealized change of every other ticker.
  //
  // Denominator: the average cost basis held, day by day, over the part of the year the
  // portfolio was active (Modified Dietz on cost). Summing the buys instead would count the same
  // money again every time it is sold and re-invested, so frequent trading made the return look
  // several times smaller than it was. A position bought for 100 that sits all year counts as
  // 100; the same 100 rotated through ten trades still counts as 100, not 1,000.
  //
  // Year-end valuations use the Dec 31 prices (yearEndPrices); the current year uses today's
  // prices since it isn't over yet, and is also shown annualized (simple/linear) over the days
  // elapsed.
  //
  // This is the fallback for when the daily price history cannot be fetched; see `byDeposit` below.
  const costBasisYearly = useMemo(() => {
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length === 0) return [];

    const applyTx = (book, t, onRealized) => {
      if (!book[t.ticker]) book[t.ticker] = { qty: 0, costBasis: 0 };
      const h = book[t.ticker];
      if (t.type === "buy") {
        h.qty += t.qty;
        h.costBasis += t.qty * t.price + t.fee;
      } else if (t.type === "sell") {
        const avgCost = h.qty > 0 ? h.costBasis / h.qty : 0;
        // Selling more than is held means a buy is missing from the records; only the part
        // that has a known cost can produce a gain.
        const sellQty = Math.min(t.qty, h.qty);
        const costOfSold = sellQty * avgCost;
        if (onRealized) onRealized(t.ticker, sellQty * t.price - t.fee - costOfSold);
        h.costBasis -= costOfSold;
        h.qty -= sellQty;
      } else if (t.type === "dividend") {
        if (onRealized) onRealized(t.ticker, t.qty);
      }
    };
    const costBasisHeld = (book) => Object.values(book).reduce((s, h) => s + (h.qty > 1e-7 ? h.costBasis : 0), 0);
    // Unrealized P&L per held ticker, or null where there is no price to value it with.
    const unrealizedByTicker = (book, priceMap) => {
      const out = {};
      for (const [ticker, h] of Object.entries(book)) {
        if (h.qty <= 1e-7) continue;
        const p = priceMap[ticker];
        out[ticker] = p === undefined || p === "" || isNaN(parseFloat(p)) ? null : parseFloat(p) * h.qty - h.costBasis;
      }
      return out;
    };
    const DAY = 24 * 60 * 60 * 1000;
    const nextDay = (d) => new Date(new Date(d).getTime() + DAY).toISOString().slice(0, 10);

    const nowYear = TODAY.slice(0, 4);
    const firstYear = Number(sorted[0].date.slice(0, 4));
    const book = {};
    let i = 0;
    let unrealizedAtStart = {};
    const result = [];

    for (let y = firstYear; y <= Number(nowYear); y++) {
      const year = String(y);
      const isYTD = year === nowYear;
      const yearEnd = isYTD ? TODAY : `${year}-12-31`;
      const heldAtStart = costBasisHeld(book) > 0;
      // A year that opens with nothing held starts counting from its first trade.
      const firstTxThisYear = sorted.find((t) => t.date.slice(0, 4) === year);
      if (!heldAtStart && !firstTxThisYear) continue;
      const periodStart = heldAtStart ? `${year}-01-01` : firstTxThisYear.date;

      const realizedByTicker = {};
      const onRealized = (ticker, amount) => (realizedByTicker[ticker] = (realizedByTicker[ticker] || 0) + amount);
      let capitalDeployed = 0;
      let capitalDays = 0;
      let days = 0;
      for (let d = periodStart; d <= yearEnd; d = nextDay(d)) {
        while (i < sorted.length && sorted[i].date <= d) {
          const t = sorted[i++];
          if (t.type === "buy") capitalDeployed += t.qty * t.price + t.fee;
          applyTx(book, t, onRealized);
        }
        capitalDays += costBasisHeld(book);
        days += 1;
      }
      const averageCapital = days > 0 ? capitalDays / days : 0;

      const priceMap = isYTD ? prices : yearEndPrices[year] || {};
      const unrealizedAtEnd = unrealizedByTicker(book, priceMap);
      const missingTickers = Object.keys(unrealizedAtEnd).filter((t) => unrealizedAtEnd[t] === null);
      // Held coming into the year but never valued at the previous year-end: its start point is
      // unknown, so its unrealized change cannot be separated from earlier years.
      const missingStartTickers = Object.keys(unrealizedAtStart).filter((t) => unrealizedAtStart[t] === null);

      let realizedGain = 0;
      for (const v of Object.values(realizedByTicker)) realizedGain += v;
      let unrealizedGainInYear = 0;
      for (const ticker of new Set([...Object.keys(unrealizedAtStart), ...Object.keys(unrealizedAtEnd)])) {
        const start = ticker in unrealizedAtStart ? unrealizedAtStart[ticker] : 0;
        const end = ticker in unrealizedAtEnd ? unrealizedAtEnd[ticker] : 0;
        if (start === null || end === null) continue;
        unrealizedGainInYear += end - start;
      }

      const totalGain = realizedGain + unrealizedGainInYear;
      const simplePct = averageCapital > 0 ? (totalGain / averageCapital) * 100 : null;
      let annualizedPct = simplePct;
      if (isYTD && simplePct !== null) annualizedPct = simplePct * (365 / Math.max(1, days));

      result.push({
        year,
        simplePct,
        annualizedPct,
        isYTD,
        periodStart,
        days,
        averageCapital,
        capitalDeployed,
        realizedGain,
        unrealizedGainInYear,
        missingTickers,
        missingStartTickers,
        // Any year missing a price is understated: that ticker's unrealized part drops out of
        // the numerator while its capital is still in the denominator.
        missingPrices: missingTickers.length > 0 || missingStartTickers.length > 0,
        needsYearEndPrices: !isYTD && missingTickers.length > 0,
      });

      unrealizedAtStart = unrealizedAtEnd;
    }
    return result;
  }, [txs, prices, yearEndPrices, TODAY]);

  // Yearly profit from the money deposited and the port's value at each year end (see
  // src/returns.js), deposits taken from the monthly statements' cash. Needs daily closes to
  // value the port wherever no statement does.
  const byDeposit = useMemo(
    () => (priceHistory && priceHistory !== "error" ? portReturns(txs, statements, priceHistory.history, prices, TODAY) : null),
    [txs, statements, priceHistory, prices, TODAY],
  );
  // Cash in the Dime account: the last statement's cash balance, moved on by the trades since.
  const wallet = byDeposit ? byDeposit.cashNow : null;

  const yearlyReturns = useMemo(
    () =>
      byDeposit
        ? byDeposit.years.map((y) => ({
            ...y,
            annualizedPct: y.simplePct,
            missingTickers: [],
            missingStartTickers: [],
            missingPrices: false,
            needsYearEndPrices: false,
          }))
        : costBasisYearly,
    [byDeposit, costBasisYearly],
  );

  // Which tickers were held at the end of each PAST (non-current) year and have no closing price
  // on the server yet, for the year-end price inputs. Checked per ticker: a year where the server
  // knows some closing prices but not all still needs inputs for the rest.
  const yearEndHoldingsNeeded = useMemo(() => {
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    const nowYear = TODAY.slice(0, 4);
    const years = [...new Set(sorted.map((t) => t.date.slice(0, 4)))].filter((y) => y !== nowYear).sort();
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
      const tickers = Object.keys(snap).filter((t) => snap[t].qty > 1e-7 && yearEndFromFile[year]?.[t] === undefined);
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
    let cumDividends = 0;
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
        cumDividends += t.qty;
      }
      points.push({
        date: t.date,
        costBasis: Math.round(cumCostBasis * 100) / 100,
        realizedAndDividends: Math.round(cumRealizedAndDividends * 100) / 100,
        dividends: cumDividends,
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

  // Growth chart points with the cash in the port that month (carried forward through months
  // with no trade), so the solid line is all the money in the port, not only what is in stocks.
  // Dividends come from the statements too: confirmation notes never carry them, so without
  // this the profit line leaves out every dividend ever paid.
  const growthWithWallet = useMemo(() => {
    const sortedStatements = [...statements].sort((a, b) => a.asOf.localeCompare(b.asOf));
    let lastCash = 0;
    return growthSeries.map((p) => {
      const known = sortedStatements.filter((st) => st.asOf.slice(0, 7) <= p.month);
      const statementDividends = known.length ? Number(known[known.length - 1].dividendsSinceStart) : 0;
      const missingDividends = Math.max(0, statementDividends - p.dividends);
      const point = { ...p, realizedAndDividends: Math.round((p.realizedAndDividends + missingDividends) * 100) / 100 };
      if (!byDeposit) return point;
      if (p.month in byDeposit.cashByMonth) lastCash = byDeposit.cashByMonth[p.month];
      const walletCash = Math.round(lastCash * 100) / 100;
      return { ...point, wallet: walletCash, costBasisAndWallet: Math.round((p.costBasis + walletCash) * 100) / 100 };
    });
  }, [growthSeries, byDeposit, statements]);

  // Dividends paid since the account opened: the larger of what is on record and what the last
  // statement says, since dividend rows only exist when someone typed them in.
  const dividendsReceived = useMemo(() => {
    const last = [...statements].sort((a, b) => a.asOf.localeCompare(b.asOf)).pop();
    return Math.max(totals.dividends, last ? Number(last.dividendsSinceStart) : 0);
  }, [statements, totals.dividends]);

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
            label="มูลค่าปัจจุบัน (หุ้น + เงินสด)"
            value={totals.hasAllPrices || totals.currentValue > 0 ? money(totals.currentValue + (wallet ?? 0), 0) : "รอราคา"}
            sub={
              !totals.hasAllPrices
                ? "บางตัวยังไม่ใส่ราคา"
                : wallet === null
                  ? "กำลังคำนวณเงินสด..."
                  : `หุ้น ${money(totals.currentValue, 0)} · เงินสด ${money(wallet, 0)}`
            }
          />
          <SummaryCard
            icon={<Wallet size={15} />}
            label="เงินสดในพอร์ต (wallet)"
            value={wallet === null ? "-" : money(wallet, 0)}
            sub={
              byDeposit?.lastStatement
                ? `จากรายงาน ณ ${byDeposit.lastStatement} + รายการหลังจากนั้น`
                : byDeposit
                  ? "ประมาณจากรายการซื้อขาย (ยังไม่มีรายงานประจำเดือน)"
                  : undefined
            }
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
          <SummaryCard
            label="ปันผลรวม"
            value={money(dividendsReceived, 0)}
            color={COLORS.gold}
            sub={dividendsReceived > totals.dividends ? "จากรายงานประจำเดือนของ Dime" : undefined}
          />
          <SummaryCard
            label="ผลตอบแทนรวมทั้งหมด"
            value={moneySigned(totals.totalReturn - totals.dividends + dividendsReceived, 0)}
            color={totals.totalReturn - totals.dividends + dividendsReceived >= 0 ? COLORS.gain : COLORS.loss}
            emphasize
          />
        </div>

        <AccountBar onImported={load} />

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
              {byDeposit
                ? "เส้นทึบ = เงินในพอร์ตทั้งหมด (ต้นทุนหุ้นที่ถืออยู่ + เงินสดใน wallet) · เส้นบาง = เงินสดใน wallet · เส้นประ = กำไรสะสม (realized + ปันผล) — ยังไม่รวมมูลค่าตลาดปัจจุบันที่ผันผวนรายวัน"
                : "เส้นทึบ = ต้นทุนที่ลงทุนอยู่สะสม (cost basis) · เส้นประ = กำไรสะสม (realized + ปันผล) — ยังไม่รวมมูลค่าตลาดปัจจุบันที่ผันผวนรายวัน"}
            </div>
            <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.panelLine}`, borderRadius: 10, padding: "14px 8px 6px" }}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={growthWithWallet} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.panelLine} vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: COLORS.muted, fontSize: 10.5 }} axisLine={{ stroke: COLORS.panelLine }} tickLine={false} />
                  <YAxis tick={{ fill: COLORS.muted, fontSize: 10.5 }} axisLine={false} tickLine={false} width={54} tickFormatter={(v) => (hideAmounts ? "" : fmt(v, 0) + "$")} />
                  <Tooltip
                    contentStyle={{ background: COLORS.ink2, border: `1px solid ${COLORS.panelLine}`, borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: COLORS.paper }}
                    formatter={(v, name) => [
                      money(v, 0),
                      {
                        costBasis: "ต้นทุนคงเหลือสะสม",
                        costBasisAndWallet: "ต้นทุนหุ้น + เงินสด",
                        wallet: "เงินสดใน wallet",
                        realizedAndDividends: "กำไรสะสม (realized+ปันผล)",
                      }[name],
                    ]}
                  />
                  <ReferenceLine y={0} stroke={COLORS.panelLine} />
                  <Line
                    type="monotone"
                    dataKey={byDeposit ? "costBasisAndWallet" : "costBasis"}
                    stroke={COLORS.gold}
                    strokeWidth={2}
                    dot={false}
                    name={byDeposit ? "costBasisAndWallet" : "costBasis"}
                  />
                  {byDeposit && <Line type="monotone" dataKey="wallet" stroke={COLORS.paper} strokeOpacity={0.6} strokeWidth={1.2} dot={false} name="wallet" />}
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
              {byDeposit
                ? "กำไรของปี = มูลค่าพอร์ตสิ้นปี − มูลค่าพอร์ตต้นปี − เงินที่เติมเข้าในปีนั้น · ผลตอบแทน = กำไร ÷ (มูลค่าต้นปี + เงินเติม) · มูลค่าพอร์ต = มูลค่าหุ้น + เงินสดในพอร์ต · เงินเติมคิดจากเงินสดในรายงานประจำเดือนของ Dime เทียบกับรายการซื้อขาย"
                : "กำไรที่ขายจริง + ปันผล + การเปลี่ยนแปลงของกำไร/ขาดทุนที่ยังไม่ขาย (เทียบราคาปิดสิ้นปีก่อนหน้ากับสิ้นปีนี้ ไม่นับซ้ำข้ามปี) เทียบกับต้นทุนที่ถืออยู่จริงเฉลี่ยรายวันในปีนั้น (เงินที่ขายแล้วซื้อใหม่ไม่ถูกนับซ้ำ) — ปีปัจจุบันแปลงเป็นอัตราเทียบเท่ารายปีตามสัดส่วนวันที่ผ่านมาแล้ว"}
              {priceHistory === null && " · กำลังโหลดราคาย้อนหลัง..."}
              {priceHistory === "error" && " · โหลดราคาย้อนหลังไม่สำเร็จ จึงใช้วิธีคำนวณจากต้นทุนแทน"}
            </div>
            {yearlyReturns.some((r) => r.isYTD && r.missingPrices) && (
              <div
                style={{
                  background: "#2A1A1A",
                  border: `1px solid ${COLORS.loss}`,
                  color: COLORS.loss,
                  padding: "8px 12px",
                  borderRadius: 6,
                  fontSize: 12,
                  marginBottom: 10,
                }}
              >
                ผลตอบแทนปีนี้ยังไม่ครบ — ไม่รวมกำไร/ขาดทุนที่ยังไม่ขายของ{" "}
                {(() => {
                  const ytd = yearlyReturns.find((r) => r.isYTD);
                  const parts = [];
                  if (ytd.missingTickers.length > 0) parts.push(`${ytd.missingTickers.join(", ")} (ขาดราคาปัจจุบัน · กดปุ่ม “ดึงราคาล่าสุด” ด้านบน)`);
                  if (ytd.missingStartTickers.length > 0) parts.push(`${ytd.missingStartTickers.join(", ")} (ขาดราคาปิดสิ้นปีก่อน)`);
                  return parts.join(" · ");
                })()}
              </div>
            )}
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
                      if (byDeposit)
                        return [`${fmtSigned(p.simplePct, 1)}% · กำไร ${moneySigned(p.profit, 0)}`, p.isYTD ? "ผลตอบแทน (ถึงวันนี้)" : "ผลตอบแทน"];
                      const lines = [fmtSigned(p.annualizedPct, 1) + "%" + (p.isYTD ? " (เทียบเท่ารายปี)" : "")];
                      if (p.isYTD) lines.push(`ตามจริง ณ วันนี้: ${fmtSigned(p.simplePct, 1)}%`);
                      if (p.needsYearEndPrices) lines.push(`ยังไม่รวม unrealized ของ ${p.missingTickers.join(", ")} — ขาดราคาปิด 31 ธ.ค.`);
                      else if (p.missingTickers.length > 0)
                        lines.push(`ยังไม่รวม unrealized ของ ${p.missingTickers.join(", ")} — ขาดราคาปัจจุบัน (กดดึงราคาล่าสุด)`);
                      if (p.missingStartTickers.length > 0)
                        lines.push(`ยังไม่รวม unrealized ของ ${p.missingStartTickers.join(", ")} — ขาดราคาปิดสิ้นปีก่อน`);
                      return [lines.join(" · "), "ผลตอบแทน"];
                    }}
                  />
                  <ReferenceLine x={0} stroke={COLORS.panelLine} />
                  <Bar dataKey="annualizedPct" radius={[0, 4, 4, 0]}>
                    {yearlyReturns.map((r, i) => (
                      <Cell
                        key={i}
                        fill={r.annualizedPct >= 0 ? COLORS.gain : COLORS.loss}
                        fillOpacity={r.missingPrices ? 0.4 : r.isYTD ? 0.75 : 1}
                      />
                    ))}
                    <LabelList
                      dataKey="annualizedPct"
                      position="right"
                      formatter={(v, entry) => fmtSigned(v, 1) + "%" + (entry && entry.missingPrices ? "*" : "")}
                      style={{ fill: COLORS.paper, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {byDeposit && byDeposit.mismatches.length > 0 && (
                <div style={{ background: "#2A1A1A", border: `1px solid ${COLORS.loss}`, color: COLORS.loss, padding: "8px 12px", borderRadius: 6, fontSize: 12, margin: "6px 8px" }}>
                  จำนวนหุ้นในรายงานประจำเดือนไม่ตรงกับรายการซื้อขายที่บันทึกไว้ — อาจมีใบยืนยันที่ไม่ได้นำเข้า ทำให้เงินเติมและกำไรคลาดเคลื่อน ·{" "}
                  {(() => {
                    // The first statement each ticker went wrong on says roughly when the trade is missing.
                    const firstSeen = {};
                    for (const m of byDeposit.mismatches) for (const d of m.diffs) if (!(d.ticker in firstSeen)) firstSeen[d.ticker] = { asOf: m.asOf, ...d };
                    return Object.values(firstSeen)
                      .map((d) => `${d.ticker} ตั้งแต่รายงาน ${d.asOf} (รายงาน ${shares(d.onStatement)} หุ้น · บันทึกไว้ ${shares(d.onRecord)} หุ้น)`)
                      .join(" · ");
                  })()}
                </div>
              )}

              {byDeposit && (
                <div style={{ borderTop: `1px solid ${COLORS.panelLine}`, marginTop: 6, padding: "8px 8px 4px", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 620 }}>
                    <thead>
                      <tr style={{ color: COLORS.muted, textAlign: "right" }}>
                        <th style={{ textAlign: "left", fontWeight: 500, padding: "4px 6px" }}>ช่วง</th>
                        <th style={{ fontWeight: 500, padding: "4px 6px" }}>มูลค่าต้นงวด</th>
                        <th style={{ fontWeight: 500, padding: "4px 6px" }}>เงินเติม</th>
                        <th style={{ fontWeight: 500, padding: "4px 6px" }}>มูลค่าปลายงวด</th>
                        <th style={{ fontWeight: 500, padding: "4px 6px" }}>กำไร</th>
                        <th style={{ fontWeight: 500, padding: "4px 6px" }}>ผลตอบแทน</th>
                      </tr>
                    </thead>
                    <tbody className="pf-mono">
                      {byDeposit.years.map((y) => (
                        <tr key={y.year} style={{ textAlign: "right", borderTop: `1px solid ${COLORS.panelLine}` }}>
                          <td style={{ textAlign: "left", padding: "5px 6px", color: COLORS.paper }}>
                            {y.year}
                            <div style={{ fontSize: 10.5, color: COLORS.muted }}>
                              {y.periodStart} → {y.periodEnd}
                            </div>
                          </td>
                          <td style={{ padding: "5px 6px" }}>{money(y.startValue, 0)}</td>
                          <td style={{ padding: "5px 6px" }}>{money(y.deposited, 0)}</td>
                          <td style={{ padding: "5px 6px" }}>{money(y.endValue, 0)}</td>
                          <td style={{ padding: "5px 6px", color: y.profit >= 0 ? COLORS.gain : COLORS.loss }}>{moneySigned(y.profit, 0)}</td>
                          <td style={{ padding: "5px 6px" }}>{y.simplePct === null ? "-" : fmtSigned(y.simplePct, 1) + "%"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 8 }}>
                    เงินเติมรวม {money(byDeposit.totalDeposited, 0)} · มูลค่าพอร์ตตอนนี้ {money(byDeposit.valueNow, 0)} (เงินสด {money(byDeposit.cashNow, 0)}) · กำไรรวม{" "}
                    {moneySigned(byDeposit.totalProfit, 0)} ·{" "}
                    <b style={{ color: byDeposit.totalPct >= 0 ? COLORS.gain : COLORS.loss }}>รวม {fmtSigned(byDeposit.totalPct, 1)}%</b>
                    {byDeposit.xirrPct !== null && (
                      <>
                        {" "}· ต่อปี (XIRR){" "}
                        <b style={{ color: byDeposit.xirrPct >= 0 ? COLORS.gain : COLORS.loss }}>{fmtSigned(byDeposit.xirrPct, 1)}%</b>
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 4 }}>
                    {byDeposit.statementCount > 0
                      ? `เงินเติมจากรายงานประจำเดือน ${byDeposit.statementCount} ฉบับ (ล่าสุด ณ ${byDeposit.lastStatement}) · หลังจากนั้นประมาณจากรายการซื้อที่เงินสดในพอร์ตไม่พอจ่าย จนกว่ารายงานฉบับถัดไปจะมา`
                      : "ยังไม่มีรายงานประจำเดือน — เงินเติมเป็นค่าประมาณจากรายการซื้อที่เงินสดในพอร์ตไม่พอจ่าย และมองไม่เห็นการถอนเงิน · กดซิงก์อีเมลเพื่อดึงรายงานประจำเดือนของ Dime"}
                    {byDeposit.approxTickers.length > 0 && <> · ไม่มีราคาย้อนหลังของ {byDeposit.approxTickers.join(", ")} จึงใช้ราคาซื้อขายล่าสุดแทน</>}
                  </div>
                </div>
              )}

              {!byDeposit && Object.keys(yearEndHoldingsNeeded).length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COLORS.panelLine}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 11, color: COLORS.muted, flex: 1, minWidth: 240 }}>
                      * ยังไม่รวมกำไร/ขาดทุนที่ยังไม่ขายของปีนั้น เพราะขาดราคาปิด ณ 31 ธ.ค. —
                      กดดึงอัตโนมัติ หรือกรอกเองก็ได้:
                    </div>
                    <button className="pf-btn-ghost" onClick={backfillYearEnd} disabled={backfilling}>
                      <RefreshCw size={14} /> {backfilling ? "กำลังดึง..." : "ดึงราคาปิดสิ้นปีอัตโนมัติ"}
                    </button>
                  </div>
                  {backfillNote && <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 8 }}>{backfillNote}</div>}
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
                                persistYearEndPrices(
                                  {
                                    ...yearEndPrices,
                                    [year]: { ...(yearEndPrices[year] || {}), [ticker]: e.target.value },
                                  },
                                  year,
                                  ticker,
                                )
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

        {byDeposit && byDeposit.monthlyDeposits.length > 0 && (
          <div style={{ marginBottom: 26 }}>
            <div className="pf-display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>
              เงินที่เติมเข้าพอร์ตรายเดือน
            </div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 10 }}>
              เงินที่โอนเข้าพอร์ตจริง ไม่นับเงินจากการขายหุ้นหรือปันผลที่นำไปซื้อต่อ · คิดจากเงินสดในรายงานประจำเดือนของ Dime เทียบกับรายการซื้อขาย · ค่าติดลบ = ถอนเงินออก ·
              แท่งจาง = ค่าประมาณ (ยังไม่มีรายงานประจำเดือน) · เดือนที่ Dime ไม่ได้ส่งรายงาน ยอดของช่วงนั้นจะแบ่งเท่า ๆ กันให้แต่ละเดือน (แท่งลาย)
            </div>
            <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.panelLine}`, borderRadius: 10, padding: "14px 8px 6px" }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={byDeposit.monthlyDeposits.map((m) => ({ ...m, label: monthLabel(m.month, m.month) }))}
                  margin={{ top: 5, right: 16, left: 0, bottom: 0 }}
                >
                  <defs>
                    {/* Striped fill for months that share one statement's amount evenly. */}
                    <pattern id="pf-split" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect width="6" height="6" fill={COLORS.gold} fillOpacity="0.55" />
                      <line x1="0" y1="0" x2="0" y2="6" stroke={COLORS.gold} strokeWidth="3" />
                    </pattern>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.panelLine} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: COLORS.muted, fontSize: 10.5 }} axisLine={{ stroke: COLORS.panelLine }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: COLORS.muted, fontSize: 10.5 }} axisLine={false} tickLine={false} width={54} tickFormatter={(v) => (hideAmounts ? "" : fmt(v, 0) + "$")} />
                  <Tooltip
                    cursor={{ fill: COLORS.panelLine, opacity: 0.4 }}
                    contentStyle={{ background: COLORS.ink2, border: `1px solid ${COLORS.panelLine}`, borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: COLORS.paper }}
                    formatter={(v, name, props) => {
                      const p = props.payload;
                      const note = p.estimated ? " (ประมาณ)" : p.splitFrom ? ` (แบ่งเฉลี่ยจากยอดรวม ${monthLabel(p.splitFrom, p.splitTo)})` : "";
                      return [moneySigned(v, 2) + note, v < 0 ? "ถอนออก" : "เติมเข้า"];
                    }}
                  />
                  <ReferenceLine y={0} stroke={COLORS.panelLine} />
                  <Bar dataKey="amount" radius={[3, 3, 0, 0]}>
                    {byDeposit.monthlyDeposits.map((m, i) => (
                      <Cell
                        key={i}
                        fill={m.splitFrom ? "url(#pf-split)" : m.amount < 0 ? COLORS.loss : COLORS.gold}
                        fillOpacity={m.estimated ? 0.4 : 1}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 12, color: COLORS.muted, padding: "8px 8px 4px", borderTop: `1px solid ${COLORS.panelLine}`, marginTop: 6 }}>
                {byDeposit.years.map((y, i) => (
                  <span key={y.year}>
                    {i > 0 && " · "}
                    เติมปี {y.year}
                    {y.isYTD ? " (ถึงวันนี้)" : ""}: <b style={{ color: COLORS.paper }}>{moneySigned(y.deposited, 0)}</b>
                  </span>
                ))}
                {" "}· รวมทั้งหมด <b style={{ color: COLORS.paper }}>{money(byDeposit.totalDeposited, 0)}</b>
              </div>
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
                      onChange={(e) => persistPrices({ ...prices, [r.ticker]: e.target.value }, r.ticker)}
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

// Account strip: who is signed in, the broker settings a sync needs, and the sync itself.
// Fetching mail runs on the server now, per account -- the browser only starts the job and
// watches it, so closing the tab does not abandon a half-finished import.
function AccountBar({ onImported }) {
  const { user, signOut } = useAuth();
  const [settings, setSettings] = useState(null);
  const [password, setPassword] = useState("");
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api
      .brokerSettings()
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);

  // A sync is a background job on the server, so its progress is polled rather than
  // awaited. Polling stops as soon as the job reaches a final state.
  useEffect(() => {
    if (!job || job.state !== "RUNNING") return;
    const timer = setInterval(async () => {
      try {
        const next = await api.job(job.id);
        setJob(next);
        if (next.state !== "RUNNING") {
          setBusy(false);
          await onImported();
        }
      } catch (e) {
        clearInterval(timer);
        setBusy(false);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [job, onImported]);

  const savePassword = async () => {
    setMessage("");
    try {
      setSettings(await api.saveBrokerSettings({ pdfPassword: password }));
      setPassword("");
      setMessage("บันทึกรหัสแล้ว");
    } catch (e) {
      setMessage(e.message || "บันทึกไม่สำเร็จ");
    }
  };

  const refreshPrices = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await api.refreshPrices();
      const failed = result.failed?.length ? ` · ไม่ได้ราคา ${result.failed.join(", ")}` : "";
      setMessage(`อัปเดตราคา ${result.updated} ตัว${failed}`);
      await onImported();
    } catch (e) {
      // The cooldown answer carries how long is left, which is the only useful thing to
      // say back -- "try again later" without a number is not an answer.
      const wait = e.body?.retryAfterSeconds;
      setMessage(wait ? `ดึงราคาได้อีกครั้งในอีก ${wait} วินาที` : e.message || "ดึงราคาไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const startSync = async () => {
    setBusy(true);
    setMessage("");
    try {
      setJob(await api.startSync());
    } catch (e) {
      setBusy(false);
      setMessage(e.message || "เริ่มงานไม่สำเร็จ");
    }
  };

  if (!user) return null;

  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.panelLine}`, borderRadius: 10, padding: "12px 14px", marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: COLORS.muted, flex: 1, minWidth: 200 }}>
          {user.email}
          {user.gmailConnected ? " · เชื่อมต่อ Gmail แล้ว" : " · ยังไม่ได้ให้สิทธิ์อ่านเมล"}
        </div>

        {message && <span style={{ fontSize: 11.5, color: COLORS.muted }}>{message}</span>}

        <button className="pf-btn" onClick={startSync} disabled={busy || !settings?.pdfPasswordSet}>
          <RefreshCw size={15} /> {busy && job ? "กำลังดึง..." : "ดึงรายการใหม่จากเมล"}
        </button>
        <button className="pf-btn-ghost" onClick={refreshPrices} disabled={busy}>
          <Coins size={15} /> ดึงราคาล่าสุด
        </button>
        <button className="pf-btn-ghost" onClick={signOut}>
          ออกจากระบบ
        </button>
      </div>

      {settings && !settings.pdfPasswordSet && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, color: COLORS.loss }}>
            ใส่รหัสเปิดไฟล์ PDF ของโบรกก่อนถึงจะดึงเมลได้ — เก็บแบบเข้ารหัส ไม่ถูกส่งกลับมาแสดงอีก
          </span>
          <input
            type="password"
            className="pf-input"
            style={{ maxWidth: 200 }}
            placeholder="รหัสเปิด PDF"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="pf-btn-ghost" onClick={savePassword} disabled={!password}>
            บันทึก
          </button>
        </div>
      )}

      {job && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11.5, color: job.state === "ERROR" ? COLORS.loss : COLORS.muted }}>
            สถานะ: {job.state}
            {job.error ? ` — ${job.error}` : ""}
          </div>
          {job.log?.length > 0 && (
            <pre
              className="pf-mono pf-scroll"
              style={{ fontSize: 11, color: COLORS.muted, marginTop: 6, maxHeight: 160, overflowY: "auto", whiteSpace: "pre-wrap" }}
            >
              {job.log.join("\n")}
            </pre>
          )}
        </div>
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

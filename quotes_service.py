#!/usr/bin/env python3
"""
Current prices, behind HTTP.

Like the parser service this holds nothing and knows no users: it is asked for a list of
tickers and answers with what the market says. Which tickers matter, whose portfolio they
belong to, and when a refresh is allowed are all decided by the API.

    GET /quotes?tickers=AAPL,MSFT
        -> { "prices": {...}, "failed": [...], "fetched_at": "..." }

    GET /closes?tickers=AAPL,MSFT&on=2025-12-31
        -> { "closes": {"AAPL": {"date": "2025-12-31", "price": 1.23}}, "failed": [...] }

    GET /history?tickers=AAPL,MSFT&start=2025-01-01&end=2026-10-04
        -> { "history": {"AAPL": {"2025-01-02": 1.23, ...}}, "failed": [...] }

Not published to the host and not in the tunnel's ingress rules.
"""

from datetime import date, datetime, timedelta, timezone

import yfinance as yf
from fastapi import FastAPI, HTTPException, Query

import get_prices

app = FastAPI(title="quotes")

# Yahoo is rate limited and slow per symbol; a single request asking for a hundred tickers
# is a mistake somewhere upstream rather than a real portfolio.
MAX_TICKERS = 100


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/quotes")
def quotes(tickers: str = Query(..., description="comma separated ticker symbols")):
    symbols = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not symbols:
        raise HTTPException(status_code=400, detail="no tickers given")
    if len(symbols) > MAX_TICKERS:
        raise HTTPException(status_code=400, detail=f"too many tickers (max {MAX_TICKERS})")

    prices, failed = get_prices.fetch_prices(symbols)
    return {
        "prices": prices,
        "failed": failed,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


@app.get("/closes")
def closes(
    tickers: str = Query(..., description="comma separated ticker symbols"),
    on: str = Query(..., description="ISO date; the last close on or before this day is returned"),
):
    """Closing price on or before a given day.

    "On or before" rather than "on", because the day asked for is usually 31 December and
    the market is shut on roughly a third of those. Falling back to the previous session is
    what a year-end valuation means anyway -- the last price the market actually set that year.
    """
    symbols = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not symbols:
        raise HTTPException(status_code=400, detail="no tickers given")
    if len(symbols) > MAX_TICKERS:
        raise HTTPException(status_code=400, detail=f"too many tickers (max {MAX_TICKERS})")

    try:
        cutoff = date.fromisoformat(on)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"bad date: {on}") from exc

    # Ten days back covers the longest run of holidays and weekends a year end can produce.
    start = cutoff - timedelta(days=10)
    end = cutoff + timedelta(days=1)

    data = yf.download(
        symbols,
        start=start.isoformat(),
        end=end.isoformat(),
        interval="1d",
        progress=False,
        group_by="ticker",
        auto_adjust=False,
    )

    found = {}
    failed = []
    for ticker in symbols:
        try:
            series = (data["Close"] if len(symbols) == 1 else data[ticker]["Close"]).dropna()
            series = series[series.index.date <= cutoff]
            if series.empty:
                failed.append(ticker)
                continue
            found[ticker] = {"date": str(series.index[-1].date()), "price": round(float(series.iloc[-1]), 4)}
        except Exception:
            failed.append(ticker)

    return {"closes": found, "failed": failed, "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def yahoo_symbol(ticker):
    # Yahoo writes share classes with a dash: BRK.B is BRK-B there.
    return ticker.replace(".", "-")


@app.get("/history")
def history(
    tickers: str = Query(..., description="comma separated ticker symbols"),
    start: str = Query(..., description="ISO date, first day wanted"),
    end: str = Query(..., description="ISO date, last day wanted"),
):
    """Daily closes for each ticker over a range, for valuing a portfolio between trades.

    Closes are split-adjusted, the same as /closes, so share counts recorded before a split
    will not match them.
    """
    symbols = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not symbols:
        raise HTTPException(status_code=400, detail="no tickers given")
    if len(symbols) > MAX_TICKERS:
        raise HTTPException(status_code=400, detail=f"too many tickers (max {MAX_TICKERS})")
    try:
        first = date.fromisoformat(start)
        last = date.fromisoformat(end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"bad date: {start} / {end}") from exc
    if first > last:
        raise HTTPException(status_code=400, detail="start is after end")

    yahoo = [yahoo_symbol(t) for t in symbols]
    # Ten extra days back so the first day of the range has a close to fall back on even
    # when it is a holiday or a weekend.
    data = yf.download(
        yahoo,
        start=(first - timedelta(days=10)).isoformat(),
        end=(last + timedelta(days=1)).isoformat(),
        interval="1d",
        progress=False,
        group_by="ticker",
        auto_adjust=False,
    )

    found = {}
    failed = []
    for ticker, symbol in zip(symbols, yahoo):
        try:
            series = (data["Close"] if len(yahoo) == 1 else data[symbol]["Close"]).dropna()
            if series.empty:
                failed.append(ticker)
                continue
            found[ticker] = {str(ts.date()): round(float(v), 4) for ts, v in series.items()}
        except Exception:
            failed.append(ticker)

    return {"history": found, "failed": failed, "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}

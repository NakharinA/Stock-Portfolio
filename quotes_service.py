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

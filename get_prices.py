#!/usr/bin/env python3
"""
Fetch current stock prices for your portfolio tickers using yfinance.

Install once:
    pip install yfinance

Run:
    python get_prices.py

Prints a table, and writes data/prices.json. The dashboard reads that file on load
and uses it for every ticker it covers, so refreshing prices is just re-running this
script -- no copying numbers by hand. It lives under public/ because that is the
directory Vite serves at the site root, which is where the dashboard fetches it from.

Under Docker:

    docker compose run --rm prices

data/prices.json format:

    {
      "fetched_at": "2026-08-20T09:30:00+00:00",
      "prices": { "AAPL": 100.0, ... }
    }
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Resolved from this file's location, not the current working directory, so the output
# lands in the served directory no matter where the script is run from.
OUTPUT_PATH = Path(__file__).resolve().parent / "data" / "prices.json"

try:
    import yfinance as yf
except ImportError:
    sys.exit("yfinance is not installed. Run: pip install yfinance")

DATA_DIR = Path(__file__).resolve().parent / "data"

# Which tickers to price is not a list anyone should have to maintain: it is whatever the
# portfolio currently holds, which the transaction files already say. Set TICKERS in the
# environment to override (comma separated), e.g. to price something before buying it.
TX_FILES = ("transactions.json", "dividends.json", "manual_transactions.json")


def load_rows():
    rows = []
    for name in TX_FILES:
        path = DATA_DIR / name
        if not path.exists():
            continue
        with open(path) as f:
            raw = json.load(f)
        rows += raw.get("transactions", raw) if isinstance(raw, dict) else raw
    return sorted(rows, key=lambda r: r["date"])


def held_tickers():
    """Tickers with an open position, replaying buys and sells in date order."""
    qty = {}
    for row in load_rows():
        ticker = row["ticker"]
        if row["type"] == "buy":
            qty[ticker] = qty.get(ticker, 0.0) + float(row["qty"])
        elif row["type"] == "sell":
            qty[ticker] = qty.get(ticker, 0.0) - float(row["qty"])
    # A sold-out position drifts to a tiny residue rather than exactly zero, because the
    # broker prints seven decimals and the arithmetic is binary floating point.
    return sorted(t for t, q in qty.items() if q > 1e-6)


def tickers():
    override = os.environ.get("TICKERS", "").strip()
    if override:
        return [t.strip().upper() for t in override.split(",") if t.strip()]
    found = held_tickers()
    if not found:
        sys.exit(
            f"no open positions found in {DATA_DIR} -- import some trades first, "
            "or set TICKERS=AAPL,MSFT to price a specific list"
        )
    return found


def fetch_prices(tickers):
    prices = {}
    failed = []

    # yf.download in one batch call is faster than looping .info per ticker.
    data = yf.download(tickers, period="1d", interval="1d", progress=False, group_by="ticker")

    for ticker in tickers:
        price = None
        try:
            if len(tickers) == 1:
                price = float(data["Close"].dropna().iloc[-1])
            else:
                price = float(data[ticker]["Close"].dropna().iloc[-1])
        except Exception:
            price = None

        # Fallback: fast_info is more reliable for some tickers (e.g. thinly-traded ones)
        if price is None:
            try:
                price = float(yf.Ticker(ticker).fast_info["last_price"])
            except Exception:
                price = None

        if price is None:
            failed.append(ticker)
        else:
            prices[ticker] = round(price, 4)

    return prices, failed


def main():
    prices, failed = fetch_prices(tickers())

    print(f"{'Ticker':<8}{'Price (USD)':>14}")
    print("-" * 22)
    for ticker, price in prices.items():
        print(f"{ticker:<8}{price:>14,.2f}")

    if failed:
        print("\nCould not fetch:", ", ".join(failed))

    payload = {
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "prices": prices,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"\nSaved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()

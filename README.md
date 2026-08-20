# Stock Portfolio

A personal dashboard for a US stock portfolio held through KKP Dime, plus the pipeline
that keeps it fed: current prices from Yahoo Finance, and trades read straight out of the
broker's confirmation notes so nothing has to be typed in by hand.

No portfolio data is in this repository. Everything personal lives in `data/`, `inbox/`,
`credentials/` and `.env`, all of which are gitignored.

## Running it

```
cp .env.example .env          # then fill in PDF_PASSWORD and GMAIL_QUERY
docker compose up -d          # dashboard on http://localhost:5173
```

`docker compose up` starts three services:

| Service | What it does |
|---|---|
| `web` | The dashboard (Vite dev server) on port 5173 |
| `api` | Local API for the dashboard's Gmail buttons |
| `prices` | Fetches prices at 20:30, 00:00 and 03:00 Asia/Bangkok |

`ingest` is a fourth, on-demand service for running the import from a terminal.

## Getting trades in

The dashboard has a panel with **เชื่อมต่อ Gmail** and **ดึงรายการใหม่จากเมล**, which is
the whole flow. It needs an OAuth client first:

1. Google Cloud Console → APIs & Services → Library → enable **Gmail API**
2. Credentials → Create credentials → OAuth client ID → **Desktop app**
3. Save the JSON as `credentials/oauth_client.json`
4. If the consent screen is in Testing, add the mailbox under Audience → Test users

Then click **เชื่อมต่อ Gmail** once. The refresh token is stored in
`credentials/token.json` and renews itself from then on.

The same thing from a terminal:

```
docker compose run --rm -p 8765:8765 ingest python auth_gmail.py   # once
docker compose run --rm ingest python fetch_email.py               # mail  -> inbox/
docker compose run --rm ingest python import_txs.py                # inbox -> data/
docker compose run --rm ingest python import_txs.py --dump         # extracted text only
docker compose run --rm prices python get_prices.py                # prices, off-schedule
```

## Where the data lives

| File | Written by | Holds |
|---|---|---|
| `data/transactions.json` | `import_txs.py` | Buys and sells, from confirmation notes |
| `data/dividends.json` | by hand | Dividends — the notes do not carry them |
| `data/manual_transactions.json` | by hand | Trades no note covers |
| `data/prices.json` | `get_prices.py` | Current price per ticker |
| `data/year_end_prices.json` | by hand | Closing price on 31 Dec, per year |

`examples/` holds a fake copy of each, to start from or to check the shape against.

There is no portfolio data in the source. Which tickers to price is read from the
transaction files, not from a list in the code, so the repository does not disclose what
is held.

Row ids say where a row came from: `i-*` imported, `u-*` typed into the dashboard,
`m-*`/`d-*` maintained by hand. Ids of imported rows are a hash of the trade itself, so
re-importing the same PDF changes nothing.

## Reading the pipeline

- `fetch_email.py` — Gmail → `inbox/*.pdf`
- `pdf_extract.py` — opens the password-locked PDFs
- `parse_rules.py` — Dime's layout → transaction rows, and the totals check that rejects
  a file whose rows do not add up to what the note says they should
- `tx_store.py` — ids, de-duplication, merging
- `import_txs.py` — ties those together
- `server.py` — the local API behind the dashboard's buttons
- `scheduler.py` — the price schedule

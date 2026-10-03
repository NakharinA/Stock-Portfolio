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

`docker compose up -d` starts:

| Service | What it does | Reachable at |
|---|---|---|
| `web` | The dashboard (Vite dev server) | 127.0.0.1:5173 |
| `api` | The NestJS backend — users, auth, transactions | 127.0.0.1:3003 |
| `db` | Postgres 17 | 127.0.0.1:5434 |
| `parser` | Stateless PDF parser the API calls | internal only |
| `legacy-api` | The original single-user Python API | 127.0.0.1:8000 |
| `prices` | Fetches prices at 20:30, 00:00 and 03:00 Asia/Bangkok | — |

Everything binds to 127.0.0.1. `ingest` (terminal imports) and `cloudflared` (the tunnel)
sit behind profiles and only start when asked for.

Database migrations:

```
docker compose exec api npx prisma migrate deploy
```

## Publishing it

`cloudflared` is the only route in from the internet — no ports are forwarded and no
origin certificate is needed. `cloudflared/config.yml` is the routing table:

| Hostname | Goes to |
|---|---|
| `port.pueyleng.com` | `web:5173` |
| `port-api.pueyleng.com` | `api:3000` |

A service not named in that file has no route in, whatever it publishes locally. That is
deliberate for `legacy-api`, which holds a Gmail grant and has no authentication.

Setup lives in `cloudflared/README.md`. Once `cloudflared/credentials.json` is in place:

```
docker compose --profile edge up -d
```

### DNS records

`cloudflared tunnel route dns` creates these; by hand they are:

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `port` | `<TUNNEL-UUID>.cfargotunnel.com` | Proxied (orange cloud) |
| CNAME | `port-api` | `<TUNNEL-UUID>.cfargotunnel.com` | Proxied (orange cloud) |

Both must be proxied: a grey-cloud record points at a hostname that does not resolve
publicly, and the tunnel is what makes it reachable. No A record and no port forwarding.

## Getting trades in

Signed in, the dashboard does the whole thing: **ดึงรายการใหม่จากเมล** starts a server-side
job that reads the mailbox, sends each confirmation note to the parser, and writes the
trades to that account. The browser only watches the job, so closing the tab does not
abandon it.

| Endpoint | Does |
|---|---|
| `PUT /api/settings/broker` | Store the PDF password (encrypted) and the Gmail query |
| `POST /api/ingest/sync` | Start a sync; returns the job |
| `GET /api/ingest/jobs/:id` | Progress and log of one job |
| `POST /api/legacy-import` | One-off move of the pre-database JSON files into an account |

Row ids are a hash of the trade, and the TypeScript and Python importers compute it the
same way, so a note imported by either path is never imported twice.

### The old terminal route

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

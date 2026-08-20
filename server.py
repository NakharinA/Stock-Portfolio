#!/usr/bin/env python3
"""
Small local API behind the dashboard: authorise Gmail and pull new trades from the
browser, instead of from a terminal.

It runs on the same machine as the dashboard and has no authentication of its own --
it is reachable only through the Vite dev server's /api proxy on localhost. Do not
publish this port anywhere: anything that can reach it can read the mailbox grant.

    GET  /api/status        what is authorised, how many rows are stored
    POST /api/auth/start    begin the Google consent flow, returns the URL to open
    POST /api/sync          fetch new mail and import it, as a background job
    GET  /api/job           progress of the running or last-finished job
"""

import io
import json
import sys
import threading
import traceback
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse

import fetch_email
import import_txs

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
TOKEN_PATH = ROOT / "credentials" / "token.json"
CLIENT_PATH = ROOT / "credentials" / "oauth_client.json"
AUTH_PORT = 8765

app = FastAPI(title="portfolio-ingest")

# One job at a time: this serves exactly one person on one machine, so a queue would be
# more machinery than the problem has.
_lock = threading.Lock()
_job = {"state": "idle", "kind": None, "log": [], "error": None}
_auth = {"state": "idle", "url": None, "error": None}


def _count(path):
    try:
        raw = json.loads(path.read_text())
        rows = raw.get("transactions", raw) if isinstance(raw, dict) else raw
        return len(rows)
    except Exception:
        return 0


@app.get("/api/status")
def status():
    prices = DATA / "prices.json"
    fetched_at = None
    try:
        fetched_at = json.loads(prices.read_text()).get("fetched_at")
    except Exception:
        pass
    return {
        "authorised": TOKEN_PATH.exists(),
        "client_configured": CLIENT_PATH.exists(),
        "counts": {
            "transactions": _count(DATA / "transactions.json"),
            "dividends": _count(DATA / "dividends.json"),
            "manual": _count(DATA / "manual_transactions.json"),
        },
        "prices_fetched_at": fetched_at,
        "job": {"state": _job["state"], "kind": _job["kind"], "error": _job["error"]},
        "auth": {"state": _auth["state"], "error": _auth["error"]},
    }


def _run_job(kind, fn):
    """Run one CLI entrypoint, keeping its printed output as the job log.

    The scripts already report themselves well in a terminal; capturing that is more
    honest than inventing a second, prettier progress format that could drift from what
    the tools actually did.
    """
    buffer = io.StringIO()
    try:
        with redirect_stdout(buffer), redirect_stderr(buffer):
            fn()
        _job["error"] = None
        _job["state"] = "done"
    except SystemExit as exc:
        # The CLIs call sys.exit(message) for expected, actionable failures.
        _job["error"] = str(exc) or "exited"
        _job["state"] = "error"
    except Exception:
        _job["error"] = traceback.format_exc(limit=3)
        _job["state"] = "error"
    finally:
        _job["log"] = buffer.getvalue().splitlines()
        _job["kind"] = kind
        _lock.release()


def _start(kind, fn):
    if not _lock.acquire(blocking=False):
        return JSONResponse({"error": "a job is already running"}, status_code=409)
    _job.update({"state": "running", "kind": kind, "log": [], "error": None})
    threading.Thread(target=_run_job, args=(kind, fn), daemon=True).start()
    return {"state": "running", "kind": kind}


@app.post("/api/sync")
def sync():
    def work():
        fetch_email.main([])
        import_txs.main([])

    return _start("sync", work)


@app.post("/api/prices")
def prices():
    import get_prices

    return _start("prices", get_prices.main)


@app.get("/api/job")
def job():
    return {"state": _job["state"], "kind": _job["kind"], "log": _job["log"][-40:], "error": _job["error"]}


def _run_auth():
    """Hold the consent flow open until the browser comes back to the loopback server."""
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow

        flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_PATH), fetch_email.SCOPES)
        # The URL is handed to the frontend rather than opened here: the browser is on the
        # host, this process is in a container, and only the host can open a window.
        _auth["url"] = flow.authorization_url(access_type="offline", prompt="consent")[0]
        creds = flow.run_local_server(port=AUTH_PORT, bind_addr="0.0.0.0", open_browser=False)
        TOKEN_PATH.write_text(creds.to_json())
        TOKEN_PATH.chmod(0o600)
        _auth.update({"state": "done", "error": None})
    except Exception as exc:
        _auth.update({"state": "error", "error": str(exc)})


@app.post("/api/auth/start")
def auth_start():
    if not CLIENT_PATH.exists():
        return JSONResponse(
            {"error": "credentials/oauth_client.json is missing -- create a Desktop OAuth client in Google Cloud Console and save it there"},
            status_code=400,
        )
    if _auth["state"] == "pending":
        return {"state": "pending", "url": _auth["url"]}

    _auth.update({"state": "pending", "url": None, "error": None})
    thread = threading.Thread(target=_run_auth, daemon=True)
    thread.start()

    # authorization_url() is set before the blocking server starts; wait briefly for it
    # rather than making the frontend poll for something that takes milliseconds.
    thread.join(timeout=5)
    if _auth["url"]:
        return {"state": _auth["state"], "url": _auth["url"]}
    return JSONResponse({"error": _auth["error"] or "could not start the consent flow"}, status_code=500)


@app.get("/api/auth/state")
def auth_state():
    return {"state": _auth["state"], "url": _auth["url"], "error": _auth["error"], "authorised": TOKEN_PATH.exists()}

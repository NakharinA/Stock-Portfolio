#!/usr/bin/env python3
"""
Runs get_prices.py on a fixed daily schedule, in Asia/Bangkok time by default:

    20:30  US market open   (09:30 ET)
    00:00  midnight
    03:00  US market close  (16:00 ET)

This is a plain loop rather than a cron daemon on purpose. Cron inside a container
runs jobs with a stripped environment and writes to its own log rather than to the
container's stdout, so failures stay invisible to `docker compose logs`. A loop keeps
the schedule, the environment, and the output all in one place.

Note the schedule is wall-clock, not exchange-aware: it fires every day, weekends and
US holidays included. On those days yfinance simply returns the last close again.

Environment:
    SCHEDULE_TZ     timezone for the times above (default Asia/Bangkok)
    RUN_ON_START    fetch once at startup before waiting (default 1)
"""

import os
import sys
import time as time_mod
import traceback
from datetime import datetime, timedelta, time
from zoneinfo import ZoneInfo

from get_prices import main as fetch_prices

RUN_TIMES = [(20, 30), (0, 0), (3, 0)]
TZ = ZoneInfo(os.environ.get("SCHEDULE_TZ", "Asia/Bangkok"))


def log(message):
    stamp = datetime.now(TZ).strftime("%Y-%m-%d %H:%M:%S %Z")
    print(f"[{stamp}] {message}", flush=True)


def next_run_after(now):
    candidates = []
    # Today and tomorrow together always contain the next slot, whatever the current time.
    for offset in (0, 1):
        day = (now + timedelta(days=offset)).date()
        for hour, minute in RUN_TIMES:
            slot = datetime.combine(day, time(hour, minute), tzinfo=TZ)
            if slot > now:
                candidates.append(slot)
    return min(candidates)


def run_once():
    try:
        fetch_prices()
    except Exception:
        # A failed fetch must not take the scheduler down with it -- a network blip should
        # cost one slot, not every future one.
        log("fetch failed:")
        traceback.print_exc()
        sys.stdout.flush()


def main():
    slots = ", ".join(f"{h:02d}:{m:02d}" for h, m in RUN_TIMES)
    log(f"scheduler started; runs at {slots} ({TZ})")

    if os.environ.get("RUN_ON_START", "1") != "0":
        log("initial fetch")
        run_once()

    while True:
        now = datetime.now(TZ)
        target = next_run_after(now)
        wait = (target - now).total_seconds()
        log(f"next fetch at {target:%Y-%m-%d %H:%M %Z} (in {wait / 3600:.2f} h)")
        time_mod.sleep(wait)
        log("scheduled fetch")
        run_once()


if __name__ == "__main__":
    main()

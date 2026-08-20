#!/usr/bin/env python3
"""
Shared transaction store: stable ids, de-duplication, and merging into
data/transactions.json (the file the dashboard reads).

The dashboard already carries a hardcoded seed list with ids s25-* / s26-*, and rows
typed into the UI get ids u-*. Imported rows use i-<hash> so all three sources can sit
in the same list without ever colliding, and so re-importing the same PDF is a no-op
instead of a duplicate.
"""

import hashlib
import json
from pathlib import Path

STORE_PATH = Path(__file__).resolve().parent / "data" / "transactions.json"

REQUIRED_FIELDS = ("date", "ticker", "type", "qty", "price", "fee")
VALID_TYPES = ("buy", "sell", "dividend")


def tx_id(tx):
    """Stable id derived from the trade itself.

    Deliberately excludes the source filename: the same trade re-sent in a corrected
    statement must land on the same id, or it would import twice.
    """
    key = "|".join(
        [
            tx["date"],
            tx["ticker"].upper(),
            tx["type"],
            f"{float(tx['qty']):.7f}",
            f"{float(tx['price']):.6f}",
            f"{float(tx['fee']):.4f}",
        ]
    )
    return "i-" + hashlib.sha256(key.encode()).hexdigest()[:10]


def validate(tx, source):
    for field in REQUIRED_FIELDS:
        if field not in tx:
            raise ValueError(f"{source}: missing field '{field}' in {tx}")
    if tx["type"] not in VALID_TYPES:
        raise ValueError(f"{source}: unknown type '{tx['type']}' in {tx}")
    if len(tx["date"]) != 10 or tx["date"][4] != "-" or tx["date"][7] != "-":
        raise ValueError(f"{source}: date must be YYYY-MM-DD, got '{tx['date']}'")
    if float(tx["qty"]) <= 0:
        raise ValueError(f"{source}: qty must be positive, got {tx['qty']}")
    # A dividend row carries the cash amount in qty and leaves price at 0; a buy or sell
    # with price 0 is a parse failure, not a real trade, and must not reach the dashboard
    # where it would silently distort average cost.
    if tx["type"] != "dividend" and float(tx["price"]) <= 0:
        raise ValueError(f"{source}: {tx['type']} needs a positive price, got {tx['price']}")
    return tx


def load():
    if not STORE_PATH.exists():
        return []
    with open(STORE_PATH) as f:
        raw = json.load(f)
    return raw.get("transactions", raw) if isinstance(raw, dict) else raw


def merge(existing, incoming):
    """Add rows whose id is not already present. Returns (merged, added)."""
    seen = {t["id"] for t in existing if isinstance(t, dict) and "id" in t}
    added = []
    for tx in incoming:
        if tx["id"] in seen:
            continue
        seen.add(tx["id"])
        added.append(tx)
    merged = sorted(existing + added, key=lambda t: (t["date"], t["ticker"]))
    return merged, added


def save(transactions):
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {"count": len(transactions), "transactions": transactions}
    with open(STORE_PATH, "w") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

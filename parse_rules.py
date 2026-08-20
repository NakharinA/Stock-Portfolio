#!/usr/bin/env python3
"""
Rules turning one KKP Dime offshore confirmation note into transaction rows.

Written against the real layout of Dime_offshore_confirmationNote_*.pdf. Each trade is
printed as a pair of lines -- the first in the traded currency, the second the THB
equivalent under the exchange venue:

    123456 05/08/2026 SEL AAPL 5.0000000 100.00 USD 500.00 0.80 0.00 499.20
    [XNAS] 16,600.00 26.60 0.00 16,573.40

    order id | settlement date | type | ticker | units | unit price | ccy |
    gross | fee incl. VAT | withholding tax | total

The date used for a row is the *effective* date printed in the header, not the
settlement date on the row: the position changes hands when the order fills, and cost
basis has to follow the fill, not the settlement two days later.

Two things this document does NOT carry, so they still need entering by hand:
  - dividends, which arrive on a different document entirely
  - the SEC/TAF fees the footnote mentions, which the note explicitly says are not
    included in the amounts shown and are charged separately in the app
"""

import re

USD_ROW = re.compile(
    r"^(?P<order>\d+)\s+"
    r"(?P<settle>\d{2}/\d{2}/\d{4})\s+"
    r"(?P<type>[A-Z]{3})\s+"
    r"(?P<ticker>[A-Z][A-Z.\-]*)\s+"
    r"(?P<qty>[\d,]+\.\d+)\s+"
    r"(?P<price>[\d,]+\.\d+)\s+"
    r"(?P<ccy>[A-Z]{3})\s+"
    r"(?P<gross>[\d,]+\.\d+)\s+"
    r"(?P<fee>[\d,]+\.\d+)\s+"
    r"(?P<withholding>[\d,]+\.\d+)\s+"
    r"(?P<total>[\d,]+\.\d+)\s*$"
)

THB_ROW = re.compile(
    r"^\[(?P<venue>[A-Z]+)\]\s+"
    r"(?P<gross>[\d,]+\.\d+)\s+"
    r"(?P<fee>[\d,]+\.\d+)\s+"
    r"(?P<withholding>[\d,]+\.\d+)\s+"
    r"(?P<total>[\d,]+\.\d+)\s*$"
)

# The header prints the effective date and the issue date on one line, in that order.
DATE_PAIR = re.compile(r"^(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})\s*$")

TOTAL_BUY = re.compile(r"รวมมูลค่าซื้อ \(THB\)\s+([\d,]+\.\d+)")
TOTAL_SELL = re.compile(r"รวมมูลค่าขาย \(THB\)\s+([\d,]+\.\d+)")

TYPE_MAP = {"BUY": "buy", "SEL": "sell"}

# Rounding across four rows and two currencies never lands exactly on the printed total.
TOTAL_TOLERANCE_THB = 0.10


class ParserNotReady(NotImplementedError):
    pass


class UnsupportedDocument(ValueError):
    """A real Dime document, but not one this pipeline knows how to read."""


class ParseError(ValueError):
    pass


def num(text):
    return float(text.replace(",", ""))


def to_iso(ddmmyyyy):
    day, month, year = ddmmyyyy.split("/")
    return f"{year}-{month}-{day}"


def effective_date(lines, source):
    for line in lines:
        match = DATE_PAIR.match(line.strip())
        if match:
            return to_iso(match.group(1))
    raise ParseError(f"{source}: no effective date found in the header")


# Dime sends two kinds of confirmation note under the same subject line. Only the offshore
# one describes US stock trades; the mutual fund note covers Thai funds, which this
# portfolio does not track and whose layout is different anyway.
OFFSHORE_MARKER = "offshore_confirmationNote"
MUTUAL_FUND_MARKER = "mutual_fund_confirmationNote"


def parse_confirmation(extracted, source):
    if MUTUAL_FUND_MARKER in source:
        raise UnsupportedDocument(f"{source}: mutual fund note -- not a US stock trade, skipped")
    if OFFSHORE_MARKER not in source:
        raise UnsupportedDocument(f"{source}: unrecognised document type, skipped")

    lines = extracted["text"].splitlines()
    date = effective_date(lines, source)

    rows = []
    for index, line in enumerate(lines):
        match = USD_ROW.match(line.strip())
        if not match:
            continue

        kind = match.group("type")
        if kind not in TYPE_MAP:
            # REW / EXC / EXP are documented on the note but have never appeared in a
            # real file. Refusing beats guessing at how they affect cost basis.
            raise ParseError(f"{source}: transaction type '{kind}' is not handled (order {match.group('order')})")

        ccy = match.group("ccy")
        if ccy != "USD":
            raise ParseError(f"{source}: expected USD amounts, found {ccy} (order {match.group('order')})")

        thb = None
        if index + 1 < len(lines):
            thb_match = THB_ROW.match(lines[index + 1].strip())
            if thb_match:
                thb = num(thb_match.group("total"))

        rows.append(
            {
                "date": date,
                "ticker": match.group("ticker"),
                "type": TYPE_MAP[kind],
                "qty": num(match.group("qty")),
                "price": num(match.group("price")),
                "fee": num(match.group("fee")),
                "order_id": match.group("order"),
                "_thb_total": thb,
            }
        )

    if not rows:
        raise ParseError(f"{source}: no trade rows matched -- the layout may have changed")

    verify_totals(extracted["text"], rows, source)

    for row in rows:
        row.pop("_thb_total", None)
    return rows


def verify_totals(text, rows, source):
    """Check the parsed rows against the THB totals the note prints for itself.

    This is the whole safety net for the import: if a row is missed, misread, or read
    twice, the sum stops matching and the file is rejected rather than quietly entering
    a wrong position into the portfolio.
    """
    for pattern, kind, label in ((TOTAL_BUY, "buy", "Total Buy"), (TOTAL_SELL, "sell", "Total Sell")):
        match = pattern.search(text)
        if not match:
            continue
        printed = num(match.group(1))
        summed = sum(r["_thb_total"] for r in rows if r["type"] == kind and r["_thb_total"] is not None)
        if abs(printed - summed) > TOTAL_TOLERANCE_THB:
            raise ParseError(
                f"{source}: {label} mismatch -- note says {printed:,.2f} THB, parsed rows sum to {summed:,.2f} THB"
            )

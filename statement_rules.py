#!/usr/bin/env python3
"""
Reads the offshore part of a Dime monthly statement ([Dime!] สรุปข้อมูลการลงทุน).

The statement holds two accounts, a Thai mutual fund account and the offshore (US stock)
account. Only the offshore one is read: from the section สรุปภาพรวมหลักทรัพย์ต่างประเทศ /
Offshore it takes the total balance (stocks at market value), the cash balance and the
dividends received since the account opened, all in USD, and from the investment
information table the shares held per ticker. Together with the trades from the
confirmation notes, cash month to month is what tells how much money was deposited.
"""

import re
from datetime import date

MONTHS = {
    "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
    "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12,
}


class NotAStatement(ValueError):
    """The document has no offshore section, so there is nothing here to read."""


def _number(raw):
    # pdfplumber can break a figure across lines ("9,102\n.15"), so whitespace goes too.
    return float(re.sub(r"[,\s]", "", raw))


def parse_statement(text):
    start = text.find("Offshore Securities Account Monthly Statement")
    summary_at = text.find("สรุปภาพรวมหลักทรัพย์ต่างประเทศ", max(start, 0))
    if start < 0 or summary_at < 0:
        raise NotAStatement("no offshore section in this document")
    offshore = text[start:]
    summary = text[summary_at:summary_at + 1500]

    total = re.search(r"Total Balance\s*([\d,\s]+\.\s*\d+)\s*USD", summary)
    cash = re.search(r"Cash Balance.*?([\d,]+\.\d+)\s*USD", summary, re.S)
    as_of = re.search(r"As of (\d{1,2}) (\w+) (\d{4})", summary)
    if not (total and cash and as_of) or as_of.group(2) not in MONTHS:
        raise ValueError("offshore section found but its balances could not be read")
    dividends = re.search(r"เงินปันผลตั้งแต่ลงทุน\s*([\d,]+\.\d+)\s*USD", summary)

    # One line per position: ticker, allocation %, shares, average cost, price, then the
    # return. Lines of the mutual fund account look the same, which is why only the text
    # after the offshore heading is searched.
    holdings = {}
    for m in re.finditer(r"^([A-Z][A-Z0-9.\-]{0,9}) [\d.]+% ([\d,]+\.\d+) [\d,]+\.\d+ [\d,]+\.\d+ [+-]", offshore, re.M):
        holdings[m.group(1)] = holdings.get(m.group(1), 0.0) + _number(m.group(2))

    return {
        "as_of": date(int(as_of.group(3)), MONTHS[as_of.group(2)], int(as_of.group(1))).isoformat(),
        "total_balance": _number(total.group(1)),
        "cash_balance": _number(cash.group(1)),
        "dividends_since_start": _number(dividends.group(1)) if dividends else 0.0,
        "holdings": holdings,
    }

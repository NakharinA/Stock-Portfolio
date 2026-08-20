#!/usr/bin/env python3
"""
Turns the confirmation PDFs sitting in inbox/ into rows in data/transactions.json.

    python import_txs.py --dump     write extracted text/tables to inbox/_extracted/ and stop
    python import_txs.py --dry-run  parse and report, change nothing on disk
    python import_txs.py            parse and merge

Importing is safe to repeat: row ids are derived from the trade itself, so a file that
has already been imported adds nothing the second time.
"""

import argparse
import json
import sys
from pathlib import Path

import pdf_extract
import parse_rules
import tx_store

INBOX = Path(__file__).resolve().parent / "inbox"
DUMP_DIR = INBOX / "_extracted"


def dump(path, extracted):
    DUMP_DIR.mkdir(parents=True, exist_ok=True)
    text_path = DUMP_DIR / (path.stem + ".txt")
    text_path.write_text(extracted["text"])
    tables_path = DUMP_DIR / (path.stem + ".tables.json")
    tables_path.write_text(json.dumps(extracted["tables"], indent=2, ensure_ascii=False))
    print(f"  dumped -> {text_path.name}, {tables_path.name}")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", action="store_true", help="write extracted content for inspection, do not parse")
    ap.add_argument("--dry-run", action="store_true", help="parse and report without writing")
    args = ap.parse_args(argv)

    pdfs = sorted(INBOX.glob("*.pdf"))
    if not pdfs:
        print(f"no PDFs in {INBOX}")
        return 0

    parsed = []
    failures = []
    skipped = []
    for path in pdfs:
        print(f"{path.name}")
        try:
            extracted = pdf_extract.extract(path)
        except pdf_extract.LockedPdfError as exc:
            failures.append(str(exc))
            print(f"  SKIPPED: {exc}")
            continue

        if args.dump:
            dump(path, extracted)
            continue

        try:
            rows = parse_rules.parse_confirmation(extracted, path.name)
        except parse_rules.UnsupportedDocument as exc:
            # Not a failure: a document this pipeline is not meant to read. Counted
            # separately so it does not hide a real parse problem in the summary.
            skipped.append(str(exc))
            print(f"  skipped: {exc}")
            continue
        except (parse_rules.ParserNotReady, parse_rules.ParseError, ValueError) as exc:
            failures.append(str(exc))
            print(f"  FAILED: {exc}")
            continue

        for row in rows:
            tx_store.validate(row, path.name)
            row["id"] = tx_store.tx_id(row)
            row["source"] = path.name
            parsed.append(row)
            print(f"  {row['date']} {row['ticker']:<6} {row['type']:<8} qty {row['qty']} @ {row['price']} fee {row['fee']}  [{row['id']}]")

    if args.dump:
        return 0

    existing = tx_store.load()
    merged, added = tx_store.merge(existing, parsed)
    print(f"\nparsed {len(parsed)} row(s) from {len(pdfs) - len(skipped) - len(failures)} file(s); "
          f"{len(added)} new, {len(parsed) - len(added)} already imported")
    if skipped:
        print(f"{len(skipped)} file(s) skipped as out of scope")

    if args.dry_run:
        print("dry run -- nothing written")
    elif added:
        tx_store.save(merged)
        print(f"wrote {tx_store.STORE_PATH} ({len(merged)} rows total)")
    else:
        print("nothing to write")

    if failures:
        print(f"\n{len(failures)} file(s) could not be imported:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

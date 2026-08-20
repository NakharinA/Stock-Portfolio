#!/usr/bin/env python3
"""
Pulls confirmation PDFs out of Gmail into inbox/, using an OAuth user credential.

    python fetch_email.py                 fetch using GMAIL_QUERY
    python fetch_email.py --query "..."   override the query for one run
    python fetch_email.py --list          show what matches, download nothing

Authorisation is a personal-account OAuth grant, not a service account: domain-wide
delegation cannot reach an @gmail.com mailbox, because the grant is made in a Workspace
admin console and a personal account does not have one. Run auth_gmail.py once to
produce credentials/token.json; from then on the refresh token renews itself silently.

Environment:
    GMAIL_QUERY   Gmail search query selecting the confirmation mails
"""

import argparse
import base64
import os
import sys
from pathlib import Path

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
ROOT = Path(__file__).resolve().parent
INBOX = ROOT / "inbox"
TOKEN_PATH = ROOT / "credentials" / "token.json"


def gmail():
    if not TOKEN_PATH.exists():
        sys.exit(
            f"no {TOKEN_PATH} -- authorise once first:\n"
            "    docker compose run --rm -p 8765:8765 ingest python auth_gmail.py"
        )
    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            # Google rotates the refresh token on some grants, so the file is rewritten
            # rather than left holding a token that has quietly been superseded.
            TOKEN_PATH.write_text(creds.to_json())
        else:
            sys.exit("stored credential is no longer usable -- re-run auth_gmail.py")
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def iter_attachments(payload):
    """Walk the MIME tree; attachments can be nested arbitrarily deep."""
    for part in payload.get("parts", []) or []:
        yield from iter_attachments(part)
    filename = payload.get("filename") or ""
    body = payload.get("body", {})
    if filename.lower().endswith(".pdf") and body.get("attachmentId"):
        yield filename, body["attachmentId"]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", default=os.environ.get("GMAIL_QUERY", ""))
    ap.add_argument("--list", action="store_true", help="show matching mails without downloading")
    ap.add_argument("--max", type=int, default=100)
    args = ap.parse_args(argv)

    if not args.query:
        sys.exit("no query given -- set GMAIL_QUERY or pass --query")

    service = gmail()
    INBOX.mkdir(parents=True, exist_ok=True)

    try:
        listing = service.users().messages().list(userId="me", q=args.query, maxResults=args.max).execute()
    except RefreshError as exc:
        sys.exit(f"Gmail rejected the stored credential ({exc}) -- re-run auth_gmail.py")
    messages = listing.get("messages", [])
    print(f"query: {args.query}\nmatched {len(messages)} mail(s)")

    saved = 0
    for meta in messages:
        msg = service.users().messages().get(userId="me", id=meta["id"], format="full").execute()
        headers = {h["name"].lower(): h["value"] for h in msg["payload"].get("headers", [])}
        subject = headers.get("subject", "(no subject)")

        if args.list:
            print(f"  {meta['id']}  {headers.get('date', '')}  {subject}")
            continue

        for filename, attachment_id in iter_attachments(msg["payload"]):
            # The message id is part of the name so two mails carrying the same filename
            # cannot overwrite each other, and so re-running skips what is already here.
            target = INBOX / f"{meta['id']}_{Path(filename).name}"
            if target.exists():
                continue
            data = service.users().messages().attachments().get(userId="me", messageId=meta["id"], id=attachment_id).execute()
            target.write_bytes(base64.urlsafe_b64decode(data["data"]))
            print(f"  saved {target.name}")
            saved += 1

    if not args.list:
        print(f"{saved} new file(s) in {INBOX}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

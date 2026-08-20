#!/usr/bin/env python3
"""
One-time Gmail authorisation for a personal (@gmail.com) account.

Domain-wide delegation only works for Workspace mailboxes, so a personal account has to
grant access itself, once, through the normal OAuth consent screen. The refresh token
that comes back is stored in credentials/token.json and every later run uses that -- no
browser, no password anywhere on disk.

Run it like this, mapping the port so the browser on the host can reach the callback
server inside the container:

    docker compose run --rm -p 8765:8765 ingest python auth_gmail.py

Then open the printed URL, approve, and the flow completes on its own.

Needs credentials/oauth_client.json, downloaded from Google Cloud Console:
    APIs & Services > Credentials > Create credentials > OAuth client ID > Desktop app
The Gmail API must be enabled on the same project, and while the consent screen is in
Testing the account has to be listed under Audience > Test users.
"""

import sys
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
CREDENTIALS = Path(__file__).resolve().parent / "credentials"
CLIENT_PATH = CREDENTIALS / "oauth_client.json"
TOKEN_PATH = CREDENTIALS / "token.json"
PORT = 8765


def main():
    if not CLIENT_PATH.exists():
        sys.exit(
            f"missing {CLIENT_PATH}\n"
            "Download it from Google Cloud Console: APIs & Services > Credentials >\n"
            "Create credentials > OAuth client ID > Desktop app, then save the JSON there."
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_PATH), SCOPES)
    # bind_addr covers the container case: the server has to listen on all interfaces for
    # the mapped port to reach it, while the redirect URI stays localhost as registered.
    creds = flow.run_local_server(port=PORT, bind_addr="0.0.0.0", open_browser=False)

    TOKEN_PATH.write_text(creds.to_json())
    TOKEN_PATH.chmod(0o600)
    print(f"\nauthorised. token saved to {TOKEN_PATH}")
    print("this file is a credential -- it is gitignored, keep it off shared drives")


if __name__ == "__main__":
    main()

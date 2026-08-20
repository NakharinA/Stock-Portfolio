#!/usr/bin/env python3
"""
Opens a password-locked trade confirmation and hands back its text and tables.

The password is read from the environment, never from an argument, so it does not end
up in shell history or in `docker inspect` output for a running container.
"""

import os
from pathlib import Path

import pdfplumber


class LockedPdfError(RuntimeError):
    pass


def password():
    value = os.environ.get("PDF_PASSWORD", "")
    if not value:
        raise LockedPdfError("PDF_PASSWORD is not set -- put it in .env, not on the command line")
    return value


def extract(path):
    """Return {"text": str, "tables": [[[cell, ...], ...], ...]} for one PDF."""
    return extract_with_password(Path(path), password())


def extract_with_password(path, pdf_password):
    """Same, with the password passed in rather than read from the environment.

    The HTTP parser service takes a password per request, because it serves several
    accounts and none of their passwords belong in its environment.
    """
    path = Path(path)
    try:
        with pdfplumber.open(path, password=pdf_password) as pdf:
            pages_text = []
            tables = []
            for page in pdf.pages:
                pages_text.append(page.extract_text() or "")
                for table in page.extract_tables():
                    tables.append(table)
    except Exception as exc:
        # pdfminer raises a generic exception for a wrong password, so the message is
        # worth rewriting -- "file has not been decrypted" tells the user nothing.
        if "decrypt" in str(exc).lower() or "password" in str(exc).lower():
            raise LockedPdfError(f"{path.name}: wrong PDF_PASSWORD, or the file is not encrypted the way we expect") from exc
        raise

    text = "\n".join(pages_text)
    # A PDF that is a scanned image has a page count but no extractable characters. That
    # needs OCR, which this pipeline does not do, so say so instead of parsing an empty string.
    if not text.strip() and not tables:
        raise LockedPdfError(
            f"{path.name}: no text layer found -- the file is probably a scan, which needs OCR rather than text extraction"
        )
    return {"text": text, "tables": tables}

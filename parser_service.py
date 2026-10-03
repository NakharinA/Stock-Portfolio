#!/usr/bin/env python3
"""
A stateless PDF parser, behind HTTP.

It holds no credentials and reads no mailbox: it is handed one confirmation note and the
password to open it, and answers with the trades inside. Everything about *whose* note it
is -- the Gmail grant, the account it belongs to, what has already been imported -- stays
in the API, where the database is.

    POST /parse       multipart: file=<pdf>, password=<str>
                      -> { "rows": [...], "source": "<filename>" }

    POST /statement   multipart: file=<pdf>, password=<str>
                      -> { "statement": { as_of, total_balance, cash_balance, ... } | null, "source": "<filename>" }

Reachable only from inside the compose network; it is not in the tunnel's ingress rules.
"""

import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

import parse_rules
import pdf_extract
import statement_rules

app = FastAPI(title="confirmation-note-parser")


@app.get("/health")
def health():
    return {"status": "ok"}


async def _extract(file, password):
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="empty file")

    # pdfplumber wants a path, and the password comes per-request rather than from the
    # environment, so the module-level helper is bypassed here deliberately.
    with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
        handle.write(payload)
        handle.flush()
        try:
            return pdf_extract.extract_with_password(Path(handle.name), password)
        except pdf_extract.LockedPdfError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/parse")
async def parse(file: UploadFile = File(...), password: str = Form(...)):
    extracted = await _extract(file, password)
    filename = file.filename or "upload.pdf"
    try:
        rows = parse_rules.parse_confirmation(extracted, filename)
    except parse_rules.UnsupportedDocument as exc:
        # Not an error: a real document this pipeline is not meant to read. The caller
        # records it as skipped rather than failed.
        return {"rows": [], "skipped": True, "reason": str(exc), "source": filename}
    except (parse_rules.ParseError, parse_rules.ParserNotReady) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {"rows": rows, "skipped": False, "source": filename}


@app.post("/statement")
async def statement(file: UploadFile = File(...), password: str = Form(...)):
    extracted = await _extract(file, password)
    filename = file.filename or "upload.pdf"
    try:
        result = statement_rules.parse_statement(extracted["text"])
    except statement_rules.NotAStatement as exc:
        # A statement with no offshore account (mutual funds only): nothing to read, not a failure.
        return {"statement": None, "skipped": True, "reason": str(exc), "source": filename}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"statement": result, "skipped": False, "source": filename}

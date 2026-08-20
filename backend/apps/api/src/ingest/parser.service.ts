import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ParseResult } from './interface/parsed-row/parsed-row.interface';

export class ParserError extends Error {}

/**
 * Client for the Python parser service. That service is stateless and credential-free:
 * it gets a document and a password and returns the trades, which keeps mailbox access and
 * account ownership on this side, where the database is.
 */
@Injectable()
export class ParserService {
  constructor(private readonly config: ConfigService) {}

  async parse(filename: string, pdf: Buffer, password: string): Promise<ParseResult> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), filename);
    form.append('password', password);

    const base = this.config.get<string>('PARSER_URL') ?? 'http://parser:8100';
    const res = await fetch(`${base}/parse`, { method: 'POST', body: form });

    if (!res.ok) {
      // 422 is the parser saying the document is wrong -- bad password, a scan with no text
      // layer, a layout it does not recognise. Its message is the useful one, so it is
      // carried through rather than replaced.
      const body: unknown = await res.json().catch(() => null);
      const detail =
        body && typeof body === 'object' && 'detail' in body ? String((body as { detail: unknown }).detail) : `parser returned ${res.status}`;
      throw new ParserError(detail);
    }

    return (await res.json()) as ParseResult;
  }
}

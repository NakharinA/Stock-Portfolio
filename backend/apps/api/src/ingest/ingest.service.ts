import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ImportJob, JobKind, JobState, Prisma, TransactionSource, TransactionType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { externalIdFor } from './class/external-id';
import { ParsedRow } from './interface/parsed-row/parsed-row.interface';
import { StatementsService } from '../statements/statements.service';
import { GmailService } from './gmail.service';
import { ParserError, ParserService } from './parser.service';

/**
 * The monthly statement mail. Fixed rather than a setting: it is Dime's own subject line, and
 * the confirmation-note query in settings is about a different kind of mail.
 */
export const STATEMENT_QUERY = 'subject:"[Dime!] สรุปข้อมูลการลงทุน" has:attachment filename:pdf';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailService,
    private readonly parser: ParserService,
    private readonly crypto: CryptoService,
    private readonly statements: StatementsService,
  ) {}

  listJobs(userId: string): Promise<ImportJob[]> {
    return this.prisma.importJob.findMany({ where: { userId }, orderBy: { startedAt: 'desc' }, take: 20 });
  }

  findJob(userId: string, id: string): Promise<ImportJob | null> {
    return this.prisma.importJob.findFirst({ where: { id, userId } });
  }

  /**
   * Starts a sync and returns immediately with the job row. A full mailbox scan takes
   * longer than a request should be held open for, so progress is read back from the job
   * rather than waited on.
   */
  async startSync(userId: string): Promise<ImportJob> {
    const running = await this.prisma.importJob.findFirst({
      where: { userId, kind: JobKind.SYNC, state: JobState.RUNNING },
    });
    // Two syncs at once would fetch and parse the same mail twice, and race on the same
    // rows. One at a time per account is enough for what this does.
    if (running) throw new BadRequestException('a sync is already running for this account');

    // Both preconditions are checked before the job row exists. Discovering them inside the
    // background run would leave the caller holding a job id that fails a moment later,
    // when the fix is something they have to do first anyway.
    const grant = await this.prisma.googleGrant.findUnique({ where: { userId } });
    if (!grant) {
      throw new UnauthorizedException('this account has not granted Gmail access -- sign in again to authorise it');
    }

    const settings = await this.prisma.brokerSetting.findUnique({ where: { userId } });
    if (!settings?.pdfPasswordEnc) {
      throw new BadRequestException('set the PDF password in settings before syncing -- the notes cannot be opened without it');
    }

    const job = await this.prisma.importJob.create({ data: { userId, kind: JobKind.SYNC } });
    void this.run(userId, job.id, settings.gmailQuery, this.crypto.decrypt(settings.pdfPasswordEnc));
    return job;
  }

  private async append(jobId: string, line: string): Promise<void> {
    await this.prisma.importJob.update({ where: { id: jobId }, data: { log: { push: line } } });
  }

  /**
   * The job log is what the person watching sees, so it reads as the four things that are
   * actually happening rather than as a trace. Failures are still spelled out line by line:
   * a note that could not be read is the one thing they need to act on, and folding it into
   * a phase would hide it.
   */
  private async run(userId: string, jobId: string, query: string, password: string): Promise<void> {
    try {
      await this.append(jobId, 'กำลังดึงข้อมูลจากอีเมล...');

      const seen = await this.prisma.sourceDocument.findMany({
        where: { userId },
        select: { gmailMessageId: true, filename: true },
      });
      const seenKeys = new Set(seen.map((d) => `${d.gmailMessageId}:${d.filename}`));
      const statements = await this.importStatements(userId, jobId, password, seenKeys);
      const attachments = await this.gmail.fetchAttachments(userId, query, seenKeys);

      if (attachments.length === 0) {
        const done = statements.saved > 0 ? `เสร็จสิ้น — ไม่มีใบยืนยันใหม่ · รายงานประจำเดือน ${statements.saved} ฉบับ` : 'เสร็จสิ้น — ไม่มีใบยืนยันใหม่';
        await this.prisma.importJob.update({
          where: { id: jobId },
          data: {
            state: statements.failed > 0 ? JobState.ERROR : JobState.DONE,
            error: statements.failed > 0 ? `${statements.failed} statement(s) could not be parsed` : null,
            finishedAt: new Date(),
            log: { push: done },
          },
        });
        return;
      }

      await this.append(jobId, 'กำลังเปิดอ่านไฟล์ที่ได้จาก email...');

      const parsed: { attachment: (typeof attachments)[number]; rows: ParsedRow[] }[] = [];
      let skipped = 0;
      let failed = 0;

      for (const attachment of attachments) {
        let result;
        try {
          result = await this.parser.parse(attachment.filename, attachment.content, password);
        } catch (error) {
          failed += 1;
          const message = error instanceof ParserError ? error.message : String(error);
          await this.append(jobId, `เปิดไม่สำเร็จ: ${attachment.filename} — ${message}`);
          continue;
        }

        if (result.skipped) {
          // Recorded as seen so the same unreadable document is not downloaded again on
          // every future sync.
          skipped += 1;
          await this.recordDocument(userId, attachment, 0);
          continue;
        }
        parsed.push({ attachment, rows: result.rows });
      }

      await this.append(jobId, 'กำลังประมวลผลและนำเข้าข้อมูล');

      let inserted = 0;
      for (const { attachment, rows } of parsed) {
        const data: Prisma.TransactionCreateManyInput[] = rows.map((row) => ({
          userId,
          externalId: externalIdFor(row),
          tradeDate: new Date(row.date),
          ticker: row.ticker.toUpperCase(),
          type: row.type === 'buy' ? TransactionType.BUY : TransactionType.SELL,
          source: TransactionSource.CONFIRMATION_NOTE,
          qty: row.qty,
          price: row.price,
          fee: row.fee,
          orderId: row.order_id ?? null,
          sourceFile: attachment.filename,
        }));

        const written = await this.prisma.transaction.createMany({ data, skipDuplicates: true });
        inserted += written.count;
        await this.recordDocument(userId, attachment, rows.length);
      }

      failed += statements.failed;
      const summary = [
        `เพิ่มใหม่ ${inserted} รายการ`,
        statements.saved > 0 ? `รายงานประจำเดือน ${statements.saved} ฉบับ` : null,
        skipped > 0 ? `ข้าม ${skipped} ไฟล์ที่ไม่ใช่ใบซื้อขายหุ้น` : null,
        failed > 0 ? `เปิดไม่สำเร็จ ${failed} ไฟล์` : null,
      ]
        .filter(Boolean)
        .join(' · ');

      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          state: failed > 0 ? JobState.ERROR : JobState.DONE,
          error: failed > 0 ? `${failed} file(s) could not be parsed` : null,
          finishedAt: new Date(),
          log: { push: `เสร็จสิ้น — ${summary}` },
        },
      });
    } catch (error) {
      this.logger.error(`sync ${jobId} failed: ${String(error)}`);
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: { state: JobState.ERROR, error: String(error), finishedAt: new Date() },
      });
    }
  }

  /**
   * Monthly statements, read before the confirmation notes. Each one is recorded as a source
   * document like a note is, so it is downloaded only once.
   */
  private async importStatements(
    userId: string,
    jobId: string,
    password: string,
    seenKeys: Set<string>,
  ): Promise<{ saved: number; failed: number }> {
    const attachments = await this.gmail.fetchAttachments(userId, STATEMENT_QUERY, seenKeys);
    let saved = 0;
    let failed = 0;
    for (const attachment of attachments) {
      try {
        const result = await this.parser.parseStatement(attachment.filename, attachment.content, password);
        if (result.statement) {
          await this.statements.save(userId, result.statement, attachment);
          saved += 1;
        }
        await this.recordDocument(userId, attachment, result.statement ? 1 : 0);
      } catch (error) {
        failed += 1;
        const message = error instanceof ParserError ? error.message : String(error);
        await this.append(jobId, `เปิดรายงานประจำเดือนไม่สำเร็จ: ${attachment.filename} — ${message}`);
      }
    }
    return { saved, failed };
  }

  private async recordDocument(
    userId: string,
    attachment: { messageId: string; filename: string; content: Buffer },
    rowCount: number,
  ): Promise<void> {
    await this.prisma.sourceDocument.upsert({
      where: {
        userId_gmailMessageId_filename: {
          userId,
          gmailMessageId: attachment.messageId,
          filename: attachment.filename,
        },
      },
      create: {
        userId,
        gmailMessageId: attachment.messageId,
        filename: attachment.filename,
        sha256: createHash('sha256').update(attachment.content).digest('hex'),
        rowCount,
      },
      update: { rowCount },
    });
  }
}

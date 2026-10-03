import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ParsedStatement } from './interface/parsed-statement/parsed-statement.interface';
import { StatementView } from './interface/statement-view/statement-view.interface';

/**
 * Monthly statements from Dime: the port's value and cash at each month end. The trades
 * only say what was bought and sold; the cash on these statements is what tells how much
 * money was deposited in between.
 */
@Injectable()
export class StatementsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string): Promise<StatementView[]> {
    const rows = await this.prisma.monthlyStatement.findMany({
      where: { userId },
      orderBy: { asOf: 'asc' },
    });
    return rows.map((row) => ({
      asOf: row.asOf.toISOString().slice(0, 10),
      totalBalance: row.totalBalance.toString(),
      cashBalance: row.cashBalance.toString(),
      dividendsSinceStart: row.dividendsSinceStart.toString(),
      holdings: (row.holdings ?? {}) as Record<string, number>,
    }));
  }

  /**
   * One row per month: Dime sometimes mails the same month twice, and a re-sent statement
   * replaces the earlier one rather than adding a second.
   */
  async save(
    userId: string,
    parsed: ParsedStatement,
    source: { messageId: string; filename: string },
  ): Promise<void> {
    const asOf = new Date(parsed.as_of);
    const data = {
      totalBalance: parsed.total_balance,
      cashBalance: parsed.cash_balance,
      dividendsSinceStart: parsed.dividends_since_start,
      holdings: parsed.holdings,
      gmailMessageId: source.messageId,
      filename: source.filename,
    };
    await this.prisma.monthlyStatement.upsert({
      where: { userId_asOf: { userId, asOf } },
      create: { userId, asOf, ...data },
      update: data,
    });
  }
}

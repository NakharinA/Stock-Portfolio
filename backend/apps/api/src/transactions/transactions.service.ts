import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Transaction, TransactionSource, TransactionType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Buys and sells describe shares at a price; dividends describe cash. Mixing the two
   * shapes is what made an earlier version of this project record dividend payments as if
   * they were share counts, so the wrong shape is rejected here rather than stored.
   */
  private assertShapeMatchesType(dto: CreateTransactionDto | UpdateTransactionDto, type: TransactionType): void {
    if (type === TransactionType.DIVIDEND) {
      if (dto.amount === undefined) {
        throw new BadRequestException('a dividend needs an amount');
      }
      if (dto.qty !== undefined || dto.price !== undefined) {
        throw new BadRequestException('a dividend has no qty or price -- use amount');
      }
      return;
    }

    if (dto.qty === undefined || dto.price === undefined) {
      throw new BadRequestException(`a ${type.toLowerCase()} needs both qty and price`);
    }
    if (dto.amount !== undefined) {
      throw new BadRequestException(`a ${type.toLowerCase()} has no amount -- use qty and price`);
    }
  }

  findAll(userId: string, query: QueryTransactionsDto): Promise<Transaction[]> {
    const where: Prisma.TransactionWhereInput = { userId };
    if (query.ticker) where.ticker = query.ticker.toUpperCase();
    if (query.type) where.type = query.type;
    if (query.from || query.to) {
      where.tradeDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    return this.prisma.transaction.findMany({ where, orderBy: [{ tradeDate: 'asc' }, { ticker: 'asc' }] });
  }

  async findOne(userId: string, id: string): Promise<Transaction> {
    // Scoped by userId, not just id: an id from another account must read as missing.
    const transaction = await this.prisma.transaction.findFirst({ where: { id, userId } });
    if (!transaction) throw new NotFoundException('transaction not found');
    return transaction;
  }

  create(userId: string, dto: CreateTransactionDto): Promise<Transaction> {
    this.assertShapeMatchesType(dto, dto.type);
    return this.prisma.transaction.create({
      data: {
        userId,
        // Hand-entered rows get a random external id; imported ones get a hash of the
        // trade, which is what makes re-importing a confirmation note a no-op.
        externalId: `u-${randomUUID()}`,
        source: TransactionSource.MANUAL,
        tradeDate: new Date(dto.tradeDate),
        ticker: dto.ticker.toUpperCase(),
        type: dto.type,
        qty: dto.qty ?? null,
        price: dto.price ?? null,
        amount: dto.amount ?? null,
        fee: dto.fee ?? 0,
        note: dto.note,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateTransactionDto): Promise<Transaction> {
    const existing = await this.findOne(userId, id);
    if (existing.source === TransactionSource.CONFIRMATION_NOTE) {
      throw new BadRequestException(
        'this row came from a broker confirmation note and is not editable -- correct it with a manual row instead',
      );
    }
    this.assertShapeMatchesType(dto, dto.type ?? existing.type);

    return this.prisma.transaction.update({
      where: { id: existing.id },
      data: {
        tradeDate: dto.tradeDate ? new Date(dto.tradeDate) : undefined,
        ticker: dto.ticker?.toUpperCase(),
        type: dto.type,
        qty: dto.qty ?? undefined,
        price: dto.price ?? undefined,
        amount: dto.amount ?? undefined,
        fee: dto.fee ?? undefined,
        note: dto.note,
      },
    });
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.findOne(userId, id);
    await this.prisma.transaction.delete({ where: { id: existing.id } });
    return { id: existing.id };
  }
}

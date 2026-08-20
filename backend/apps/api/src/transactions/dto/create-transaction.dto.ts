import { TransactionType } from '@prisma/client';
import { IsEnum, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, Length, Matches } from 'class-validator';

export class CreateTransactionDto {
  @IsISO8601()
  tradeDate!: string;

  @IsString()
  @Length(1, 12)
  @Matches(/^[A-Za-z][A-Za-z.\-]*$/, { message: 'ticker must look like a ticker symbol' })
  ticker!: string;

  @IsEnum(TransactionType)
  type!: TransactionType;

  /** Share count. Required for BUY and SELL, meaningless for DIVIDEND. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  qty?: number;

  /** Price per share. Required for BUY and SELL. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  price?: number;

  /** Cash received. Required for DIVIDEND. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsNumber()
  fee?: number;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

import { IsNumber, IsPositive } from 'class-validator';

export class SetPriceDto {
  @IsNumber()
  @IsPositive()
  price!: number;
}

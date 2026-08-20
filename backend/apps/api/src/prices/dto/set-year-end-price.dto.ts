import { IsInt, IsNumber, IsPositive, Max, Min } from 'class-validator';

export class SetYearEndPriceDto {
  @IsInt()
  @Min(1970)
  @Max(2200)
  year!: number;

  @IsNumber()
  @IsPositive()
  price!: number;
}

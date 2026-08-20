import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateBrokerSettingDto {
  /** The password on the broker's confirmation PDFs. Stored encrypted, never returned. */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  pdfPassword?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  gmailQuery?: string;
}

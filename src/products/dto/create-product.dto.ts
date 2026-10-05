import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

const SELLING_PRICE = /^\d{1,10}(\.\d{1,2})?$/;
const GST_RATE = /^\d{1,3}(\.\d{1,2})?$/;

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  sku?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsString()
  @Matches(SELLING_PRICE)
  sellingPrice: string;

  @IsString()
  @Matches(GST_RATE)
  gstRate: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unit?: string;
}

import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';

const SELLING_PRICE = /^\d{1,10}(\.\d{1,2})?$/;
const GST_RATE = /^\d{1,3}(\.\d{1,2})?$/;

export class UpdateProductDto {
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  categoryId?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  sku?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @Matches(SELLING_PRICE)
  sellingPrice?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @Matches(GST_RATE)
  gstRate?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  unit?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}

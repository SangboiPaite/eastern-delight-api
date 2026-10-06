import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '../../../generated/prisma/client.js';

const POSITIVE_QUANTITY = /^(?!0+(?:\.0+)?$)\d{1,9}(\.\d{1,3})?$/;

export class CreateInvoiceItemDto {
  @IsUUID()
  productId: string;

  @IsString()
  @Matches(POSITIVE_QUANTITY)
  quantity: string;
}

export class CreateInvoiceDto {
  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  transactionRef?: string | null;
}

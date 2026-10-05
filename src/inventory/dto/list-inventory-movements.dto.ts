import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { InventoryMovementType } from '../../../generated/prisma/client.js';

export class ListInventoryMovementsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  productId?: string;

  @IsOptional()
  @IsEnum(InventoryMovementType)
  type?: InventoryMovementType;
}

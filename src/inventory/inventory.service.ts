import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { CurrentUserContext } from '../auth/current-user.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CreateInventoryMovementDto } from './dto/create-inventory-movement.dto.js';
import type {
  InventoryMovementListResponse,
  InventoryMovementResponse,
} from './dto/inventory-movement-response.dto.js';
import type { ListInventoryMovementsDto } from './dto/list-inventory-movements.dto.js';

const PRODUCT_NOT_FOUND = 'Product not found.';
const MOVEMENT_NOT_FOUND = 'Inventory movement not found.';
const INSUFFICIENT_STOCK = 'Insufficient stock.';
const ZERO_ADJUSTMENT = 'Adjustment does not change the current stock.';
const STOCK_CHANGED =
  'Stock changed before this movement could be recorded.';
const UNSUPPORTED_MOVEMENT = 'This movement type cannot be recorded here.';

const MOVEMENT_READ_SELECT = {
  id: true,
  productId: true,
  type: true,
  quantity: true,
  previousStock: true,
  newStock: true,
  note: true,
  createdById: true,
  createdAt: true,
} as const;

type DecimalValue = {
  toString(): string;
};

type MovementReadRecord = {
  id: string;
  productId: string;
  type: InventoryMovementResponse['type'];
  quantity: DecimalValue;
  previousStock: DecimalValue;
  newStock: DecimalValue;
  note: string | null;
  createdById: string | null;
  createdAt: Date;
};

type LockedProduct = {
  id: string;
  stockQty: Prisma.Decimal | string | number;
};

function toMovementResponse(
  movement: MovementReadRecord,
): InventoryMovementResponse {
  return {
    id: movement.id,
    productId: movement.productId,
    type: movement.type,
    quantity: movement.quantity.toString(),
    previousStock: movement.previousStock.toString(),
    newStock: movement.newStock.toString(),
    note: movement.note,
    createdById: movement.createdById,
    createdAt: movement.createdAt,
  };
}

function calculateMovement(
  dto: CreateInventoryMovementDto,
  previous: Prisma.Decimal,
): { quantity: Prisma.Decimal; newStock: Prisma.Decimal } {
  if (dto.type === 'ADJUSTMENT') {
    const target = new Prisma.Decimal(dto.targetStock ?? '');
    if (target.lt(0)) {
      throw new ConflictException(INSUFFICIENT_STOCK);
    }
    if (target.minus(previous).isZero()) {
      throw new ConflictException(ZERO_ADJUSTMENT);
    }
    return { quantity: target.minus(previous).abs(), newStock: target };
  }

  const quantity = new Prisma.Decimal(dto.quantity ?? '');
  if (!quantity.gt(0)) {
    throw new ConflictException(INSUFFICIENT_STOCK);
  }

  const newStock =
    dto.type === 'DAMAGE'
      ? previous.minus(quantity)
      : dto.type === 'OPENING_STOCK'
        ? quantity
        : dto.type === 'PURCHASE' || dto.type === 'RETURN'
          ? previous.plus(quantity)
          : null;
  if (!newStock) {
    throw new ConflictException(UNSUPPORTED_MOVEMENT);
  }
  if (newStock.lt(0)) {
    throw new ConflictException(INSUFFICIENT_STOCK);
  }
  return { quantity, newStock };
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listMovements(
    query: ListInventoryMovementsDto,
  ): Promise<InventoryMovementListResponse> {
    const movements = await this.prisma.inventoryMovement.findMany({
      where: {
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      select: MOVEMENT_READ_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return {
      movements: movements.map((movement) => toMovementResponse(movement)),
    };
  }

  async getMovementById(id: string): Promise<InventoryMovementResponse> {
    const movement = await this.prisma.inventoryMovement.findUnique({
      where: { id },
      select: MOVEMENT_READ_SELECT,
    });
    if (!movement) {
      throw new NotFoundException(MOVEMENT_NOT_FOUND);
    }
    return toMovementResponse(movement);
  }

  async createMovement(
    dto: CreateInventoryMovementDto,
    currentUser: CurrentUserContext,
  ): Promise<InventoryMovementResponse> {
    const movement = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<LockedProduct[]>(
        Prisma.sql`SELECT id, "stockQty" FROM "Product" WHERE id = CAST(${dto.productId} AS uuid) FOR UPDATE`,
      );
      const product = locked[0];
      if (!product) {
        throw new NotFoundException(PRODUCT_NOT_FOUND);
      }

      const previous = new Prisma.Decimal(product.stockQty);
      const calculated = calculateMovement(dto, previous);
      const updated = await tx.product.updateMany({
        where: { id: dto.productId, stockQty: previous },
        data: { stockQty: calculated.newStock },
      });
      if (updated.count !== 1) {
        const exists = await tx.product.findUnique({
          where: { id: dto.productId },
          select: { id: true },
        });
        if (!exists) {
          throw new NotFoundException(PRODUCT_NOT_FOUND);
        }
        throw new ConflictException(STOCK_CHANGED);
      }

      return tx.inventoryMovement.create({
        data: {
          productId: dto.productId,
          type: dto.type,
          quantity: calculated.quantity,
          previousStock: previous,
          newStock: calculated.newStock,
          createdById: currentUser.id,
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
        select: MOVEMENT_READ_SELECT,
      });
    });
    return toMovementResponse(movement);
  }
}

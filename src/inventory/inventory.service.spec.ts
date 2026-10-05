import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { CurrentUserContext } from '../auth/current-user.js';
import { PrismaService } from '../database/prisma.service.js';
import { InventoryService } from './inventory.service.js';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const MOVEMENT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = new Date('2026-03-01T00:00:00.000Z');

function actor(): CurrentUserContext {
  return {
    id: USER_ID,
    organizationId: '44444444-4444-4444-8444-444444444444',
    role: 'STAFF',
  };
}

function movementRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: MOVEMENT_ID,
    productId: PRODUCT_ID,
    type: 'PURCHASE',
    quantity: '2.500',
    previousStock: '10.000',
    newStock: '12.500',
    note: 'Delivery',
    createdById: USER_ID,
    createdAt: CREATED_AT,
    product: { name: 'Ladoo' },
    createdBy: { name: 'Ada' },
    ...overrides,
  };
}

describe('InventoryService', () => {
  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    product: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    inventoryMovement: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };
  const service = new InventoryService(prisma as unknown as PrismaService);

  beforeEach(() => {
    prisma.$queryRaw.mockReset().mockResolvedValue([
      { id: PRODUCT_ID, stockQty: '10.000' },
    ]);
    prisma.product.findUnique.mockReset().mockResolvedValue({ id: PRODUCT_ID });
    prisma.product.updateMany.mockReset().mockResolvedValue({ count: 1 });
    prisma.inventoryMovement.findMany.mockReset().mockResolvedValue([
      movementRecord(),
    ]);
    prisma.inventoryMovement.findUnique
      .mockReset()
      .mockResolvedValue(movementRecord());
    prisma.inventoryMovement.create.mockReset().mockResolvedValue(
      movementRecord(),
    );
    prisma.$transaction.mockReset().mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
  });

  function movementCreate(): { data: Record<string, { toString(): string } | string | null>; select: Record<string, unknown> } {
    return prisma.inventoryMovement.create.mock.calls[0]?.[0] as {
      data: Record<string, { toString(): string } | string | null>;
      select: Record<string, unknown>;
    };
  }

  function stockUpdate(): {
    where: { id: string; stockQty: { toString(): string } };
    data: { stockQty: { toString(): string } };
  } {
    return prisma.product.updateMany.mock.calls[0]?.[0] as {
      where: { id: string; stockQty: { toString(): string } };
      data: { stockQty: { toString(): string } };
    };
  }

  function expectDecimal(value: { toString(): string } | string | null, expected: string): void {
    expect(new Prisma.Decimal(value?.toString() ?? '').eq(expected)).toBe(true);
  }

  const safeSelect = {
    id: true,
    productId: true,
    type: true,
    quantity: true,
    previousStock: true,
    newStock: true,
    note: true,
    createdById: true,
    createdAt: true,
  };

  it('lists movements newest first and can filter by product and type', async () => {
    await service.listMovements({
      productId: PRODUCT_ID,
      type: 'PURCHASE',
    });

    expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith({
      where: { productId: PRODUCT_ID, type: 'PURCHASE' },
      select: safeSelect,
      orderBy: { createdAt: 'desc' },
    });
    expect(safeSelect).not.toHaveProperty('product');
    expect(safeSelect).not.toHaveProperty('createdBy');
  });

  it('returns 404 when a movement does not exist', async () => {
    prisma.inventoryMovement.findUnique.mockResolvedValue(null);

    await expect(service.getMovementById(MOVEMENT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getMovementById(MOVEMENT_ID)).rejects.toMatchObject({
      status: 404,
      message: 'Inventory movement not found.',
    });
  });

  it.each([
    ['PURCHASE', '2.500', '12.500'],
    ['RETURN', '2.500', '12.500'],
  ] as const)(
    '%s increases stock by the supplied quantity',
    async (type, quantity, next) => {
      await service.createMovement(
        { productId: PRODUCT_ID, type, quantity },
        actor(),
      );

      expectDecimal(stockUpdate().where.stockQty, '10');
      expectDecimal(stockUpdate().data.stockQty, next);
      const data = movementCreate().data;
      expect(data.type).toBe(type);
      expectDecimal(data.quantity, quantity);
      expectDecimal(data.previousStock, '10');
      expectDecimal(data.newStock, next);
      expect(data.createdById).toBe(USER_ID);
      expect(data).not.toHaveProperty('referenceType');
      expect(data).not.toHaveProperty('referenceId');
    },
  );

  it('decreases stock for DAMAGE and rejects a shortage', async () => {
    await service.createMovement(
      { productId: PRODUCT_ID, type: 'DAMAGE', quantity: '4' },
      actor(),
    );

    expectDecimal(stockUpdate().data.stockQty, '6');
    expectDecimal(movementCreate().data.newStock, '6');

    prisma.product.updateMany.mockClear();
    prisma.inventoryMovement.create.mockClear();
    await expect(
      service.createMovement(
        { productId: PRODUCT_ID, type: 'DAMAGE', quantity: '10.001' },
        actor(),
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Insufficient stock.',
    });
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('sets stock to the OPENING_STOCK quantity', async () => {
    await service.createMovement(
      { productId: PRODUCT_ID, type: 'OPENING_STOCK', quantity: '25.500' },
      actor(),
    );

    expectDecimal(movementCreate().data.quantity, '25.500');
    expectDecimal(movementCreate().data.previousStock, '10');
    expectDecimal(movementCreate().data.newStock, '25.500');
    expectDecimal(stockUpdate().data.stockQty, '25.500');
  });

  it('records an ADJUSTMENT as the absolute difference and the target stock', async () => {
    await service.createMovement(
      { productId: PRODUCT_ID, type: 'ADJUSTMENT', targetStock: '7.250' },
      actor(),
    );

    expectDecimal(movementCreate().data.quantity, '2.750');
    expectDecimal(movementCreate().data.previousStock, '10');
    expectDecimal(movementCreate().data.newStock, '7.250');
    expectDecimal(stockUpdate().data.stockQty, '7.250');
  });

  it('rejects a negative ADJUSTMENT target and a zero difference', async () => {
    await expect(
      service.createMovement(
        { productId: PRODUCT_ID, type: 'ADJUSTMENT', targetStock: '-1' },
        actor(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.createMovement(
        { productId: PRODUCT_ID, type: 'ADJUSTMENT', targetStock: '-1' },
        actor(),
      ),
    ).rejects.toMatchObject({ status: 409, message: 'Insufficient stock.' });

    prisma.product.updateMany.mockClear();
    await expect(
      service.createMovement(
        { productId: PRODUCT_ID, type: 'ADJUSTMENT', targetStock: '10' },
        actor(),
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Adjustment does not change the current stock.',
    });
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('rejects SALE even when the service is called directly', async () => {
    await expect(
      service.createMovement(
        {
          productId: PRODUCT_ID,
          type: 'SALE' as 'PURCHASE',
          quantity: '1',
        },
        actor(),
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: 'This movement type cannot be recorded here.',
    });
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('returns 404 when the product does not exist', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(
      service.createMovement(
        { productId: PRODUCT_ID, type: 'PURCHASE', quantity: '1' },
        actor(),
      ),
    ).rejects.toMatchObject({
      status: 404,
      message: 'Product not found.',
    });
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('stores an optional note and the authenticated user as createdById', async () => {
    const result = await service.createMovement(
      {
        productId: PRODUCT_ID,
        type: 'PURCHASE',
        quantity: '1',
        note: 'Morning delivery',
      },
      actor(),
    );

    expect(movementCreate().data.note).toBe('Morning delivery');
    expect(movementCreate().data.createdById).toBe(USER_ID);
    expect(movementCreate().select).toEqual(safeSelect);
    expect(result).not.toHaveProperty('product');
    expect(result).not.toHaveProperty('createdBy');
    expect(JSON.stringify(result)).not.toMatch(/Ladoo|"Ada"/);
  });

  it('does not create a movement when stock changed after it was read', async () => {
    prisma.product.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.createMovement(
        { productId: PRODUCT_ID, type: 'PURCHASE', quantity: '1' },
        actor(),
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Stock changed before this movement could be recorded.',
    });
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('keeps the stock write and movement insert in one transaction', async () => {
    const order: string[] = [];
    let committedStock = '10.000';
    prisma.$transaction.mockImplementation(async (fn) => {
      let pending = committedStock;
      const tx = {
        $queryRaw: vi.fn(async () => {
          order.push('lock');
          return [{ id: PRODUCT_ID, stockQty: pending }];
        }),
        product: {
          findUnique: prisma.product.findUnique,
          updateMany: vi.fn(async (args: { data: { stockQty: { toString(): string } } }) => {
            order.push('updateStock');
            pending = args.data.stockQty.toString();
            return { count: 1 };
          }),
        },
        inventoryMovement: {
          create: vi.fn(async () => {
            order.push('createMovement');
            throw new Error('database unavailable');
          }),
        },
      };
      try {
        const result = await fn(tx);
        committedStock = pending;
        return result;
      } catch (error) {
        throw error;
      }
    });

    await expect(
      service.createMovement(
        { productId: PRODUCT_ID, type: 'PURCHASE', quantity: '5' },
        actor(),
      ),
    ).rejects.toThrow('database unavailable');
    expect(order).toEqual(['lock', 'updateStock', 'createMovement']);
    expect(committedStock).toBe('10.000');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

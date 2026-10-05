import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProductsService } from './products.service.js';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');

function productRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    categoryId: CATEGORY_ID,
    name: 'Ladoo',
    sku: 'LAD-1',
    description: 'Besan ladoo',
    sellingPrice: '120.00',
    gstRate: '5.00',
    stockQty: '10.000',
    unit: 'pcs',
    isActive: true,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    invoiceItems: [{ id: 'invoice-item-1' }],
    inventoryMovements: [{ id: 'movement-1' }],
    ...overrides,
  };
}

describe('ProductsService', () => {
  const prisma = {
    category: {
      findUnique: vi.fn(),
    },
    product: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  const service = new ProductsService(prisma as unknown as PrismaService);

  beforeEach(() => {
    prisma.category.findUnique.mockReset().mockResolvedValue({
      id: CATEGORY_ID,
      isActive: true,
    });
    prisma.product.findMany.mockReset().mockResolvedValue([productRecord()]);
    prisma.product.findUnique.mockReset().mockResolvedValue(productRecord());
    prisma.product.create.mockReset().mockResolvedValue(productRecord());
    prisma.product.update.mockReset().mockResolvedValue(productRecord());
  });

  const safeSelect = {
    id: true,
    categoryId: true,
    name: true,
    sku: true,
    description: true,
    sellingPrice: true,
    gstRate: true,
    stockQty: true,
    unit: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
  };

  function expectSafeSelect(select: Record<string, unknown>): void {
    expect(select).toEqual(safeSelect);
    expect(select).not.toHaveProperty('invoiceItems');
    expect(select).not.toHaveProperty('inventoryMovements');
    expect(select).not.toHaveProperty('category');
  }

  function safeProduct(overrides: Record<string, unknown> = {}) {
    return {
      id: PRODUCT_ID,
      categoryId: CATEGORY_ID,
      name: 'Ladoo',
      sku: 'LAD-1',
      description: 'Besan ladoo',
      sellingPrice: '120.00',
      gstRate: '5.00',
      stockQty: '10.000',
      unit: 'pcs',
      isActive: true,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      ...overrides,
    };
  }

  function createCall(): {
    data: Record<string, unknown>;
    select: Record<string, unknown>;
  } {
    return prisma.product.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
      select: Record<string, unknown>;
    };
  }

  function updateCall(): {
    where: { id: string };
    data: Record<string, unknown>;
    select: Record<string, unknown>;
  } {
    return prisma.product.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: Record<string, unknown>;
      select: Record<string, unknown>;
    };
  }

  function expectStockAndRelationsUntouched(data: Record<string, unknown>): void {
    expect(data).not.toHaveProperty('stockQty');
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('createdAt');
    expect(data).not.toHaveProperty('updatedAt');
    expect(data).not.toHaveProperty('invoiceItems');
    expect(data).not.toHaveProperty('inventoryMovements');
  }

  it('lists products without invoice or inventory records', async () => {
    const result = await service.listProducts();

    expectSafeSelect(
      (
        prisma.product.findMany.mock.calls[0]?.[0] as {
          select: Record<string, unknown>;
          orderBy: unknown;
        }
      ).select,
    );
    expect(prisma.product.findMany.mock.calls[0]?.[0].orderBy).toEqual({
      createdAt: 'asc',
    });
    expect(result).toEqual({ products: [safeProduct()] });
    expect(result.products[0]).not.toHaveProperty('invoiceItems');
    expect(result.products[0]).not.toHaveProperty('inventoryMovements');
    expect(JSON.stringify(result)).not.toMatch(/invoiceItems|inventoryMovements/);
  });

  it('gets one product by id', async () => {
    const result = await service.getProductById(PRODUCT_ID);

    expect(prisma.product.findUnique).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      select: safeSelect,
    });
    expect(result).toEqual(safeProduct());
  });

  it('returns 404 when the product does not exist', async () => {
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(service.getProductById(PRODUCT_ID)).rejects.toMatchObject({
      status: 404,
      message: 'Product not found.',
    });
  });

  it('creates a product without sku, unit, stock, or isActive', async () => {
    const result = await service.createProduct({
      categoryId: CATEGORY_ID,
      name: 'Ladoo',
      sellingPrice: '120.50',
      gstRate: '5',
    });

    expect(prisma.category.findUnique).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID },
      select: { id: true, isActive: true },
    });
    expect(createCall().data).toEqual({
      categoryId: CATEGORY_ID,
      name: 'Ladoo',
      sellingPrice: '120.50',
      gstRate: '5',
    });
    expect(createCall().data).not.toHaveProperty('sku');
    expect(createCall().data).not.toHaveProperty('unit');
    expect(createCall().data).not.toHaveProperty('isActive');
    expectStockAndRelationsUntouched(createCall().data);
    expectSafeSelect(createCall().select);
    expect(result).toEqual(safeProduct());
    expect(result).not.toHaveProperty('invoiceItems');
  });

  it('stores an optional sku, description, and unit', async () => {
    await service.createProduct({
      categoryId: CATEGORY_ID,
      name: 'Ladoo',
      sku: 'LAD-1',
      description: 'Besan ladoo',
      sellingPrice: '120.00',
      gstRate: '5.00',
      unit: 'box',
    });

    expect(createCall().data).toEqual({
      categoryId: CATEGORY_ID,
      name: 'Ladoo',
      sku: 'LAD-1',
      description: 'Besan ladoo',
      sellingPrice: '120.00',
      gstRate: '5.00',
      unit: 'box',
    });
    expectStockAndRelationsUntouched(createCall().data);
  });

  it('returns 404 when the category does not exist', async () => {
    prisma.category.findUnique.mockResolvedValue(null);

    await expect(
      service.createProduct({
        categoryId: CATEGORY_ID,
        name: 'Ladoo',
        sellingPrice: '10.00',
        gstRate: '0',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createProduct({
        categoryId: CATEGORY_ID,
        name: 'Ladoo',
        sellingPrice: '10.00',
        gstRate: '0',
      }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'Category not found.',
    });
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('returns 409 when the category is inactive', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: CATEGORY_ID,
      isActive: false,
    });

    await expect(
      service.createProduct({
        categoryId: CATEGORY_ID,
        name: 'Ladoo',
        sellingPrice: '10.00',
        gstRate: '0',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.createProduct({
        categoryId: CATEGORY_ID,
        name: 'Ladoo',
        sellingPrice: '10.00',
        gstRate: '0',
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Category is not active.',
    });
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('returns 409 when the SKU is already in use', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`sku`)',
      {
        code: 'P2002',
        clientVersion: '7.10.0',
        meta: { modelName: 'Product', target: ['sku'] },
      },
    );
    prisma.product.create.mockRejectedValue(conflict);

    await expect(
      service.createProduct({
        categoryId: CATEGORY_ID,
        name: 'Ladoo',
        sku: 'LAD-1',
        sellingPrice: '10.00',
        gstRate: '0',
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'SKU is already in use.',
    });
  });

  it('propagates unrelated database errors on create', async () => {
    const nameConflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '7.10.0',
        meta: { modelName: 'Category', target: ['name'] },
      },
    );
    prisma.product.create.mockRejectedValue(nameConflict);
    await expect(
      service.createProduct({
        categoryId: CATEGORY_ID,
        name: 'Ladoo',
        sellingPrice: '10.00',
        gstRate: '0',
      }),
    ).rejects.toBe(nameConflict);

    const unavailable = new Error('database unavailable');
    prisma.product.create.mockRejectedValue(unavailable);
    await expect(
      service.createProduct({
        categoryId: CATEGORY_ID,
        name: 'Ladoo',
        sellingPrice: '10.00',
        gstRate: '0',
      }),
    ).rejects.toBe(unavailable);
  });

  it('maps a category foreign-key violation to 404', async () => {
    const missingCategory = new Prisma.PrismaClientKnownRequestError(
      'Foreign key constraint failed',
      {
        code: 'P2003',
        clientVersion: '7.10.0',
        meta: {
          modelName: 'Product',
          constraint: 'Product_categoryId_fkey',
        },
      },
    );
    prisma.product.create.mockRejectedValue(missingCategory);

    await expect(
      service.createProduct({
        categoryId: CATEGORY_ID,
        name: 'Ladoo',
        sellingPrice: '10.00',
        gstRate: '0',
      }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'Category not found.',
    });
  });

  it('updates supplied fields and can deactivate the product', async () => {
    prisma.product.update.mockResolvedValue(
      productRecord({ name: 'Festive ladoo', isActive: false, unit: 'box' }),
    );

    const result = await service.updateProduct(PRODUCT_ID, {
      name: 'Festive ladoo',
      sellingPrice: '150.00',
      gstRate: '12.00',
      unit: 'box',
      isActive: false,
    });

    expect(prisma.category.findUnique).not.toHaveBeenCalled();
    expect(updateCall().where).toEqual({ id: PRODUCT_ID });
    expect(updateCall().data).toEqual({
      name: 'Festive ladoo',
      sellingPrice: '150.00',
      gstRate: '12.00',
      unit: 'box',
      isActive: false,
    });
    expect(updateCall().data).not.toHaveProperty('isActive', true);
    expectStockAndRelationsUntouched(updateCall().data);
    expectSafeSelect(updateCall().select);
    expect(result.isActive).toBe(false);
    expect(result).not.toHaveProperty('invoiceItems');
    expect(result).not.toHaveProperty('inventoryMovements');
  });

  it('rejects an inactive category when categoryId changes', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: CATEGORY_ID,
      isActive: false,
    });

    await expect(
      service.updateProduct(PRODUCT_ID, { categoryId: CATEGORY_ID }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Category is not active.',
    });
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('returns 404 when an update names a missing category', async () => {
    prisma.category.findUnique.mockResolvedValue(null);

    await expect(
      service.updateProduct(PRODUCT_ID, { categoryId: CATEGORY_ID }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'Category not found.',
    });
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('returns the current product for an empty patch without a mutation', async () => {
    const result = await service.updateProduct(PRODUCT_ID, {});

    expect(result).toEqual(safeProduct());
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.category.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when updating a missing product', async () => {
    const missing = new Prisma.PrismaClientKnownRequestError(
      'Record to update not found.',
      {
        code: 'P2025',
        clientVersion: '7.10.0',
        meta: { modelName: 'Product' },
      },
    );
    prisma.product.update.mockRejectedValue(missing);

    await expect(
      service.updateProduct(PRODUCT_ID, { name: 'Ladoo' }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'Product not found.',
    });
  });

  it('returns 409 when an update reuses another SKU', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`sku`)',
      {
        code: 'P2002',
        clientVersion: '7.10.0',
        meta: { modelName: 'Product', target: ['sku'] },
      },
    );
    prisma.product.update.mockRejectedValue(conflict);

    await expect(
      service.updateProduct(PRODUCT_ID, { sku: 'LAD-1' }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'SKU is already in use.',
    });
  });

  it('propagates unrelated database errors on update', async () => {
    const unavailable = new Error('database unavailable');
    prisma.product.update.mockRejectedValue(unavailable);

    await expect(
      service.updateProduct(PRODUCT_ID, { name: 'Ladoo' }),
    ).rejects.toBe(unavailable);
  });
});

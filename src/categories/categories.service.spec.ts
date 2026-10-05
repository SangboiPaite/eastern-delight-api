import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { CategoriesService } from './categories.service.js';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');

function categoryRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: CATEGORY_ID,
    name: 'Sweets',
    description: 'Traditional sweets',
    isActive: true,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    products: [{ id: 'product-1', name: 'Ladoo' }],
    ...overrides,
  };
}

describe('CategoriesService', () => {
  const prisma = {
    category: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  const service = new CategoriesService(prisma as unknown as PrismaService);

  beforeEach(() => {
    prisma.category.findMany.mockReset().mockResolvedValue([categoryRecord()]);
    prisma.category.findUnique.mockReset().mockResolvedValue(categoryRecord());
    prisma.category.create.mockReset().mockResolvedValue(categoryRecord());
    prisma.category.update.mockReset().mockResolvedValue(categoryRecord());
  });

  function listQuery(): {
    select: Record<string, unknown>;
    orderBy: unknown;
  } {
    return prisma.category.findMany.mock.calls[0]?.[0] as {
      select: Record<string, unknown>;
      orderBy: unknown;
    };
  }

  function uniqueQuery(): {
    where: { id: string };
    select: Record<string, unknown>;
  } {
    return prisma.category.findUnique.mock.calls[0]?.[0] as {
      where: { id: string };
      select: Record<string, unknown>;
    };
  }

  function expectSafeSelect(select: Record<string, unknown>): void {
    expect(select).toEqual({
      id: true,
      name: true,
      description: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    });
    expect(select).not.toHaveProperty('products');
  }

  function safeCategory(overrides: Record<string, unknown> = {}) {
    return {
      id: CATEGORY_ID,
      name: 'Sweets',
      description: 'Traditional sweets',
      isActive: true,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      ...overrides,
    };
  }

  it('lists categories without product data', async () => {
    const result = await service.listCategories();

    expectSafeSelect(listQuery().select);
    expect(listQuery().orderBy).toEqual({ createdAt: 'asc' });
    expect(result).toEqual({ categories: [safeCategory()] });
    expect(result.categories[0]).not.toHaveProperty('products');
    expect(JSON.stringify(result)).not.toMatch(/products|Ladoo/);
  });

  it('gets one category by id', async () => {
    const result = await service.getCategoryById(CATEGORY_ID);

    expect(uniqueQuery().where).toEqual({ id: CATEGORY_ID });
    expectSafeSelect(uniqueQuery().select);
    expect(result).toEqual(safeCategory());
    expect(result).not.toHaveProperty('products');
  });

  it('returns 404 when the category does not exist', async () => {
    prisma.category.findUnique.mockResolvedValue(null);

    await expect(service.getCategoryById(CATEGORY_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getCategoryById(CATEGORY_ID)).rejects.toMatchObject({
      status: 404,
      message: 'Category not found.',
    });
  });

  it('creates a category without setting isActive or products', async () => {
    const result = await service.createCategory({ name: 'Savouries' });

    expect(prisma.category.create).toHaveBeenCalledWith({
      data: { name: 'Savouries' },
      select: expect.any(Object),
    });
    const created = prisma.category.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    expect(created.data).not.toHaveProperty('isActive');
    expect(created.data).not.toHaveProperty('id');
    expect(created.data).not.toHaveProperty('createdAt');
    expect(created.data).not.toHaveProperty('updatedAt');
    expect(created.data).not.toHaveProperty('products');
    expectSafeSelect(created.select);
    expect(result).toEqual(safeCategory());
    expect(result).not.toHaveProperty('products');
  });

  it('stores an optional description on create', async () => {
    await service.createCategory({
      name: 'Savouries',
      description: 'Snacks',
    });

    expect(prisma.category.create).toHaveBeenCalledWith({
      data: { name: 'Savouries', description: 'Snacks' },
      select: expect.any(Object),
    });
  });

  it('returns 409 when the category name is already in use', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`name`)',
      {
        code: 'P2002',
        clientVersion: '7.10.0',
        meta: { modelName: 'Category', target: ['name'] },
      },
    );
    prisma.category.create.mockRejectedValue(conflict);

    await expect(
      service.createCategory({ name: 'Sweets' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.createCategory({ name: 'Sweets' })).rejects.toMatchObject(
      {
        status: 409,
        message: 'Category name is already in use.',
      },
    );
  });

  it('propagates unrelated database errors on create', async () => {
    const skuConflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '7.10.0',
        meta: { modelName: 'Product', target: ['sku'] },
      },
    );
    prisma.category.create.mockRejectedValue(skuConflict);

    await expect(service.createCategory({ name: 'Sweets' })).rejects.toBe(
      skuConflict,
    );

    const unavailable = new Error('database unavailable');
    prisma.category.create.mockRejectedValue(unavailable);
    await expect(service.createCategory({ name: 'Sweets' })).rejects.toBe(
      unavailable,
    );
  });

  it('updates only the supplied category fields', async () => {
    prisma.category.update.mockResolvedValue(
      categoryRecord({
        name: 'Festive sweets',
        description: null,
        isActive: false,
      }),
    );

    const result = await service.updateCategory(CATEGORY_ID, {
      name: 'Festive sweets',
      description: null,
      isActive: false,
    });

    const updated = prisma.category.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    expect(updated.where).toEqual({ id: CATEGORY_ID });
    expect(updated.data).toEqual({
      name: 'Festive sweets',
      description: null,
      isActive: false,
    });
    expect(updated.data).not.toHaveProperty('id');
    expect(updated.data).not.toHaveProperty('createdAt');
    expect(updated.data).not.toHaveProperty('updatedAt');
    expect(updated.data).not.toHaveProperty('products');
    expectSafeSelect(updated.select);
    expect(result).toEqual(
      safeCategory({
        name: 'Festive sweets',
        description: null,
        isActive: false,
      }),
    );
    expect(result).not.toHaveProperty('products');
  });

  it('returns the current category for an empty patch without a mutation', async () => {
    const result = await service.updateCategory(CATEGORY_ID, {});

    expect(result).toEqual(safeCategory());
    expect(prisma.category.update).not.toHaveBeenCalled();
    expectSafeSelect(uniqueQuery().select);
  });

  it('returns 404 when updating a missing category', async () => {
    const missing = new Prisma.PrismaClientKnownRequestError(
      'Record to update not found.',
      {
        code: 'P2025',
        clientVersion: '7.10.0',
        meta: { modelName: 'Category' },
      },
    );
    prisma.category.update.mockRejectedValue(missing);

    await expect(
      service.updateCategory(CATEGORY_ID, { name: 'Savouries' }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'Category not found.',
    });
  });

  it('returns 409 when an update reuses another category name', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`name`)',
      {
        code: 'P2002',
        clientVersion: '7.10.0',
        meta: { modelName: 'Category', target: ['name'] },
      },
    );
    prisma.category.update.mockRejectedValue(conflict);

    await expect(
      service.updateCategory(CATEGORY_ID, { name: 'Sweets' }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Category name is already in use.',
    });
  });

  it('propagates unrelated database errors on update', async () => {
    const unavailable = new Error('database unavailable');
    prisma.category.update.mockRejectedValue(unavailable);

    await expect(
      service.updateCategory(CATEGORY_ID, { isActive: false }),
    ).rejects.toBe(unavailable);
  });
});

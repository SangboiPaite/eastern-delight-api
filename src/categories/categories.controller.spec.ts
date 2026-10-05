import {
  ArgumentMetadata,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { ROLES_KEY } from '../auth/roles.decorator.js';
import { SERVICE_PERMISSION_KEY } from '../auth/service-permission.decorator.js';
import { ServicePermissionGuard } from '../auth/service-permission.guard.js';
import { TokenService } from '../auth/token.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import type {
  CategoryListResponse,
  CategoryResponse,
} from './dto/category-response.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';

const categoryResponse: CategoryResponse = {
  id: CATEGORY_ID,
  name: 'Sweets',
  description: 'Traditional sweets',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
};

describe('CategoriesController', () => {
  const categories = {
    listCategories: vi.fn(),
    getCategoryById: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
  };

  async function controller(): Promise<CategoriesController> {
    const module = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [
        { provide: CategoriesService, useValue: categories },
        { provide: TokenService, useValue: { verifyAccessToken: vi.fn() } },
        {
          provide: PrismaService,
          useValue: { userServicePermission: { findMany: vi.fn() } },
        },
        Reflector,
      ],
    }).compile();
    return module.get(CategoriesController);
  }

  beforeEach(() => {
    categories.listCategories.mockReset().mockResolvedValue({
      categories: [categoryResponse],
    });
    categories.getCategoryById.mockReset().mockResolvedValue(categoryResponse);
    categories.createCategory.mockReset().mockResolvedValue(categoryResponse);
    categories.updateCategory.mockReset().mockResolvedValue(categoryResponse);
  });

  it('requires an authenticated user with the PRODUCTS permission', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CategoriesController)).toBe(
      'categories',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, CategoriesController)).toEqual([
      AccessTokenGuard,
      ServicePermissionGuard,
    ]);
    expect(
      Reflect.getMetadata(SERVICE_PERMISSION_KEY, CategoriesController),
    ).toEqual(['PRODUCTS']);
    expect(Reflect.getMetadata(ROLES_KEY, CategoriesController)).toBeUndefined();
  });

  it('delegates GET /categories to CategoriesService', async () => {
    const expected: CategoryListResponse = { categories: [categoryResponse] };
    categories.listCategories.mockResolvedValue(expected);

    await expect((await controller()).list()).resolves.toEqual(expected);
    expect(categories.listCategories).toHaveBeenCalledWith();
    expect(
      Reflect.getMetadata(PATH_METADATA, CategoriesController.prototype.list),
    ).toBe('/');
    expect(
      Reflect.getMetadata(METHOD_METADATA, CategoriesController.prototype.list),
    ).toBe(RequestMethod.GET);
  });

  it('delegates GET /categories/:id to CategoriesService', async () => {
    await expect((await controller()).getById(CATEGORY_ID)).resolves.toEqual(
      categoryResponse,
    );
    expect(categories.getCategoryById).toHaveBeenCalledWith(CATEGORY_ID);
    expect(
      Reflect.getMetadata(PATH_METADATA, CategoriesController.prototype.getById),
    ).toBe(':id');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        CategoriesController.prototype.getById,
      ),
    ).toBe(RequestMethod.GET);
  });

  it('delegates POST /categories to CategoriesService', async () => {
    const dto = { name: 'Savouries', description: 'Snacks' };

    await expect((await controller()).create(dto)).resolves.toEqual(
      categoryResponse,
    );
    expect(categories.createCategory).toHaveBeenCalledWith(dto);
    expect(
      Reflect.getMetadata(PATH_METADATA, CategoriesController.prototype.create),
    ).toBe('/');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        CategoriesController.prototype.create,
      ),
    ).toBe(RequestMethod.POST);
  });

  it('delegates PATCH /categories/:id to CategoriesService', async () => {
    const dto = { name: 'Festive sweets', isActive: false };

    await expect(
      (await controller()).update(CATEGORY_ID, dto),
    ).resolves.toEqual(categoryResponse);
    expect(categories.updateCategory).toHaveBeenCalledWith(CATEGORY_ID, dto);
    expect(
      Reflect.getMetadata(PATH_METADATA, CategoriesController.prototype.update),
    ).toBe(':id');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        CategoriesController.prototype.update,
      ),
    ).toBe(RequestMethod.PATCH);
    expect(Reflect.getMetadata(GUARDS_METADATA, CategoriesController)).toEqual([
      AccessTokenGuard,
      ServicePermissionGuard,
    ]);
    expect(
      Reflect.getMetadata(SERVICE_PERMISSION_KEY, CategoriesController),
    ).toEqual(['PRODUCTS']);
  });
});

describe('CreateCategoryDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: CreateCategoryDto,
  };

  it('accepts a name and an optional description', async () => {
    const dto = (await pipe.transform(
      { name: 'Savouries', description: 'Snacks' },
      metadata,
    )) as CreateCategoryDto;

    expect(dto).toEqual({ name: 'Savouries', description: 'Snacks' });
  });

  it('rejects a missing or empty name', async () => {
    await expect(pipe.transform({}, metadata)).rejects.toBeDefined();
    await expect(
      pipe.transform({ name: '' }, metadata),
    ).rejects.toBeDefined();
  });

  it('rejects protected category fields', async () => {
    const body = { name: 'Savouries' };

    await expect(
      pipe.transform({ ...body, id: CATEGORY_ID }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...body, createdAt: '2026-01-01' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...body, updatedAt: '2026-01-02' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...body, products: [] }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...body, isActive: false }, metadata),
    ).rejects.toBeDefined();
  });
});

describe('UpdateCategoryDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: UpdateCategoryDto,
  };

  it('accepts name, description, and isActive', async () => {
    const dto = (await pipe.transform(
      { name: 'Festive sweets', description: null, isActive: false },
      metadata,
    )) as UpdateCategoryDto;

    expect(dto.name).toBe('Festive sweets');
    expect(dto.description).toBeNull();
    expect(dto.isActive).toBe(false);
  });

  it('accepts an empty patch', async () => {
    const dto = (await pipe.transform({}, metadata)) as UpdateCategoryDto;

    expect(dto.name).toBeUndefined();
    expect(dto.description).toBeUndefined();
    expect(dto.isActive).toBeUndefined();
  });

  it('rejects an empty name or a non-boolean isActive', async () => {
    await expect(
      pipe.transform({ name: '' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ isActive: 'false' }, metadata),
    ).rejects.toBeDefined();
  });

  it('rejects protected category fields', async () => {
    await expect(
      pipe.transform({ id: CATEGORY_ID }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ createdAt: '2026-01-01' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ updatedAt: '2026-01-02' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ products: [] }, metadata),
    ).rejects.toBeDefined();
  });
});

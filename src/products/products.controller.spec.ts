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
import { CreateProductDto } from './dto/create-product.dto.js';
import type {
  ProductListResponse,
  ProductResponse,
} from './dto/product-response.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';

const productResponse: ProductResponse = {
  id: PRODUCT_ID,
  categoryId: CATEGORY_ID,
  name: 'Ladoo',
  sku: 'LAD-1',
  description: 'Besan ladoo',
  sellingPrice: '120.00',
  gstRate: '5.00',
  stockQty: '0',
  unit: 'pcs',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
};

const createBody = {
  categoryId: CATEGORY_ID,
  name: 'Ladoo',
  sellingPrice: '120.50',
  gstRate: '5',
};

describe('ProductsController', () => {
  const products = {
    listProducts: vi.fn(),
    getProductById: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
  };

  async function controller(): Promise<ProductsController> {
    const module = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: products },
        { provide: TokenService, useValue: { verifyAccessToken: vi.fn() } },
        {
          provide: PrismaService,
          useValue: { userServicePermission: { findMany: vi.fn() } },
        },
        Reflector,
      ],
    }).compile();
    return module.get(ProductsController);
  }

  beforeEach(() => {
    products.listProducts.mockReset().mockResolvedValue({
      products: [productResponse],
    });
    products.getProductById.mockReset().mockResolvedValue(productResponse);
    products.createProduct.mockReset().mockResolvedValue(productResponse);
    products.updateProduct.mockReset().mockResolvedValue(productResponse);
  });

  it('requires an authenticated user with the PRODUCTS permission', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ProductsController)).toBe(
      'products',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, ProductsController)).toEqual([
      AccessTokenGuard,
      ServicePermissionGuard,
    ]);
    expect(
      Reflect.getMetadata(SERVICE_PERMISSION_KEY, ProductsController),
    ).toEqual(['PRODUCTS']);
    expect(Reflect.getMetadata(ROLES_KEY, ProductsController)).toBeUndefined();
  });

  it('delegates GET /products to ProductsService', async () => {
    const expected: ProductListResponse = { products: [productResponse] };
    products.listProducts.mockResolvedValue(expected);

    await expect((await controller()).list()).resolves.toEqual(expected);
    expect(products.listProducts).toHaveBeenCalledWith();
    expect(
      Reflect.getMetadata(PATH_METADATA, ProductsController.prototype.list),
    ).toBe('/');
    expect(
      Reflect.getMetadata(METHOD_METADATA, ProductsController.prototype.list),
    ).toBe(RequestMethod.GET);
  });

  it('delegates GET /products/:id to ProductsService', async () => {
    await expect((await controller()).getById(PRODUCT_ID)).resolves.toEqual(
      productResponse,
    );
    expect(products.getProductById).toHaveBeenCalledWith(PRODUCT_ID);
    expect(
      Reflect.getMetadata(PATH_METADATA, ProductsController.prototype.getById),
    ).toBe(':id');
    expect(
      Reflect.getMetadata(METHOD_METADATA, ProductsController.prototype.getById),
    ).toBe(RequestMethod.GET);
  });

  it('delegates POST /products to ProductsService', async () => {
    await expect((await controller()).create(createBody)).resolves.toEqual(
      productResponse,
    );
    expect(products.createProduct).toHaveBeenCalledWith(createBody);
    expect(
      Reflect.getMetadata(PATH_METADATA, ProductsController.prototype.create),
    ).toBe('/');
    expect(
      Reflect.getMetadata(METHOD_METADATA, ProductsController.prototype.create),
    ).toBe(RequestMethod.POST);
  });

  it('delegates PATCH /products/:id to ProductsService', async () => {
    const dto = { name: 'Festive ladoo', isActive: false };

    await expect(
      (await controller()).update(PRODUCT_ID, dto),
    ).resolves.toEqual(productResponse);
    expect(products.updateProduct).toHaveBeenCalledWith(PRODUCT_ID, dto);
    expect(
      Reflect.getMetadata(PATH_METADATA, ProductsController.prototype.update),
    ).toBe(':id');
    expect(
      Reflect.getMetadata(METHOD_METADATA, ProductsController.prototype.update),
    ).toBe(RequestMethod.PATCH);
    expect(Reflect.getMetadata(GUARDS_METADATA, ProductsController)).toEqual([
      AccessTokenGuard,
      ServicePermissionGuard,
    ]);
    expect(
      Reflect.getMetadata(SERVICE_PERMISSION_KEY, ProductsController),
    ).toEqual(['PRODUCTS']);
  });
});

describe('CreateProductDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: CreateProductDto,
  };

  it('accepts required fields and optional sku, description, and unit', async () => {
    const dto = (await pipe.transform(
      {
        ...createBody,
        sku: 'LAD-1',
        description: 'Besan ladoo',
        unit: 'box',
      },
      metadata,
    )) as CreateProductDto;

    expect(dto.categoryId).toBe(CATEGORY_ID);
    expect(dto.name).toBe('Ladoo');
    expect(dto.sku).toBe('LAD-1');
    expect(dto.description).toBe('Besan ladoo');
    expect(dto.sellingPrice).toBe('120.50');
    expect(dto.gstRate).toBe('5');
    expect(dto.unit).toBe('box');
  });

  it('accepts a product without a sku', async () => {
    const dto = (await pipe.transform(createBody, metadata)) as CreateProductDto;

    expect(dto.sku).toBeUndefined();
    expect(dto.unit).toBeUndefined();
  });

  it('rejects a missing price, an over-precise amount, or an empty name', async () => {
    await expect(
      pipe.transform({ ...createBody, sellingPrice: undefined }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...createBody, sellingPrice: '10.555' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...createBody, gstRate: '1000.00' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...createBody, name: '' }, metadata),
    ).rejects.toBeDefined();
  });

  it('rejects stock, activation, identity, and relation fields', async () => {
    await expect(
      pipe.transform({ ...createBody, stockQty: '5' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...createBody, isActive: false }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...createBody, id: PRODUCT_ID }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...createBody, createdAt: '2026-01-01' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...createBody, updatedAt: '2026-01-02' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...createBody, invoiceItems: [] }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...createBody, inventoryMovements: [] }, metadata),
    ).rejects.toBeDefined();
  });
});

describe('UpdateProductDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: UpdateProductDto,
  };

  it('accepts category, catalog fields, and isActive', async () => {
    const dto = (await pipe.transform(
      {
        categoryId: CATEGORY_ID,
        name: 'Festive ladoo',
        sku: null,
        description: null,
        sellingPrice: '150.00',
        gstRate: '12.5',
        unit: 'box',
        isActive: false,
      },
      metadata,
    )) as UpdateProductDto;

    expect(dto.categoryId).toBe(CATEGORY_ID);
    expect(dto.sku).toBeNull();
    expect(dto.description).toBeNull();
    expect(dto.sellingPrice).toBe('150.00');
    expect(dto.gstRate).toBe('12.5');
    expect(dto.isActive).toBe(false);
  });

  it('accepts an empty patch', async () => {
    const dto = (await pipe.transform({}, metadata)) as UpdateProductDto;

    expect(dto.name).toBeUndefined();
    expect(dto.isActive).toBeUndefined();
  });

  it('rejects stock and relation fields', async () => {
    await expect(
      pipe.transform({ stockQty: '1' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ id: PRODUCT_ID }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ createdAt: '2026-01-01' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ updatedAt: '2026-01-02' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ invoiceItems: [] }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ inventoryMovements: [] }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ isActive: 'false' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ sellingPrice: '10.555' }, metadata),
    ).rejects.toBeDefined();
  });
});

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
import type { CurrentUserContext } from '../auth/current-user.js';
import { ROLES_KEY } from '../auth/roles.decorator.js';
import { SERVICE_PERMISSION_KEY } from '../auth/service-permission.decorator.js';
import { ServicePermissionGuard } from '../auth/service-permission.guard.js';
import { TokenService } from '../auth/token.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { CreateInventoryMovementDto } from './dto/create-inventory-movement.dto.js';
import type { InventoryMovementResponse } from './dto/inventory-movement-response.dto.js';
import { ListInventoryMovementsDto } from './dto/list-inventory-movements.dto.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const MOVEMENT_ID = '22222222-2222-4222-8222-222222222222';
const currentUser: CurrentUserContext = {
  id: '33333333-3333-4333-8333-333333333333',
  organizationId: '44444444-4444-4444-8444-444444444444',
  role: 'STAFF',
};

const movementResponse: InventoryMovementResponse = {
  id: MOVEMENT_ID,
  productId: PRODUCT_ID,
  type: 'PURCHASE',
  quantity: '2.500',
  previousStock: '10.000',
  newStock: '12.500',
  note: null,
  createdById: currentUser.id,
  createdAt: new Date('2026-03-01T00:00:00.000Z'),
};

describe('InventoryController', () => {
  const inventory = {
    listMovements: vi.fn(),
    getMovementById: vi.fn(),
    createMovement: vi.fn(),
  };

  async function controller(): Promise<InventoryController> {
    const module = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        { provide: InventoryService, useValue: inventory },
        { provide: TokenService, useValue: { verifyAccessToken: vi.fn() } },
        {
          provide: PrismaService,
          useValue: { userServicePermission: { findMany: vi.fn() } },
        },
        Reflector,
      ],
    }).compile();
    return module.get(InventoryController);
  }

  beforeEach(() => {
    inventory.listMovements.mockReset().mockResolvedValue({
      movements: [movementResponse],
    });
    inventory.getMovementById.mockReset().mockResolvedValue(movementResponse);
    inventory.createMovement.mockReset().mockResolvedValue(movementResponse);
  });

  it('requires an authenticated user with the PRODUCTS permission', () => {
    expect(Reflect.getMetadata(PATH_METADATA, InventoryController)).toBe(
      'inventory/movements',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, InventoryController)).toEqual([
      AccessTokenGuard,
      ServicePermissionGuard,
    ]);
    expect(
      Reflect.getMetadata(SERVICE_PERMISSION_KEY, InventoryController),
    ).toEqual(['PRODUCTS']);
    expect(Reflect.getMetadata(ROLES_KEY, InventoryController)).toBeUndefined();
  });

  it('delegates POST /inventory/movements with the authenticated user', async () => {
    const dto = {
      productId: PRODUCT_ID,
      type: 'PURCHASE' as const,
      quantity: '2.500',
    };

    await expect(
      (await controller()).create(dto, currentUser),
    ).resolves.toEqual(movementResponse);
    expect(inventory.createMovement).toHaveBeenCalledWith(dto, currentUser);
    expect(
      Reflect.getMetadata(PATH_METADATA, InventoryController.prototype.create),
    ).toBe('/');
    expect(
      Reflect.getMetadata(METHOD_METADATA, InventoryController.prototype.create),
    ).toBe(RequestMethod.POST);
  });

  it('delegates GET /inventory/movements with the list filters', async () => {
    const query = { productId: PRODUCT_ID, type: 'DAMAGE' as const };

    await expect((await controller()).list(query)).resolves.toEqual({
      movements: [movementResponse],
    });
    expect(inventory.listMovements).toHaveBeenCalledWith(query);
    expect(
      Reflect.getMetadata(PATH_METADATA, InventoryController.prototype.list),
    ).toBe('/');
    expect(
      Reflect.getMetadata(METHOD_METADATA, InventoryController.prototype.list),
    ).toBe(RequestMethod.GET);
  });

  it('delegates GET /inventory/movements/:id', async () => {
    await expect((await controller()).getById(MOVEMENT_ID)).resolves.toEqual(
      movementResponse,
    );
    expect(inventory.getMovementById).toHaveBeenCalledWith(MOVEMENT_ID);
    expect(
      Reflect.getMetadata(PATH_METADATA, InventoryController.prototype.getById),
    ).toBe(':id');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        InventoryController.prototype.getById,
      ),
    ).toBe(RequestMethod.GET);
  });
});

describe('CreateInventoryMovementDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: CreateInventoryMovementDto,
  };

  it('accepts quantity movements and an adjustment target', async () => {
    const purchase = (await pipe.transform(
      { productId: PRODUCT_ID, type: 'PURCHASE', quantity: '2.500', note: 'ok' },
      metadata,
    )) as CreateInventoryMovementDto;
    const adjustment = (await pipe.transform(
      { productId: PRODUCT_ID, type: 'ADJUSTMENT', targetStock: '0' },
      metadata,
    )) as CreateInventoryMovementDto;

    expect(purchase.quantity).toBe('2.500');
    expect(purchase.note).toBe('ok');
    expect(adjustment.targetStock).toBe('0');
    expect(adjustment.quantity).toBeUndefined();
  });

  it('rejects SALE, a non-positive quantity, and a negative target', async () => {
    await expect(
      pipe.transform(
        { productId: PRODUCT_ID, type: 'SALE', quantity: '1' },
        metadata,
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        { productId: PRODUCT_ID, type: 'DAMAGE', quantity: '0' },
        metadata,
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        { productId: PRODUCT_ID, type: 'ADJUSTMENT', targetStock: '-1' },
        metadata,
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        { productId: PRODUCT_ID, type: 'PURCHASE', targetStock: '5' },
        metadata,
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ type: 'PURCHASE', quantity: '1' }, metadata),
    ).rejects.toBeDefined();
  });

  it('rejects server-owned stock, reference, and actor fields', async () => {
    const body = { productId: PRODUCT_ID, type: 'PURCHASE', quantity: '1' };

    await expect(
      pipe.transform({ ...body, previousStock: '10' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...body, newStock: '11' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...body, referenceType: 'Invoice' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...body, referenceId: MOVEMENT_ID }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...body, createdById: currentUser.id }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...body, id: MOVEMENT_ID }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...body, createdAt: '2026-03-01' }, metadata),
    ).rejects.toBeDefined();
  });
});

describe('ListInventoryMovementsDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: ListInventoryMovementsDto,
  };

  it('accepts product and movement-type filters', async () => {
    const dto = (await pipe.transform(
      { productId: PRODUCT_ID, type: 'OPENING_STOCK' },
      metadata,
    )) as ListInventoryMovementsDto;

    expect(dto.productId).toBe(PRODUCT_ID);
    expect(dto.type).toBe('OPENING_STOCK');
  });

  it('rejects an unknown movement type', async () => {
    await expect(
      pipe.transform({ type: 'TRANSFER' }, metadata),
    ).rejects.toBeDefined();
  });
});

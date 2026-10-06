import {
  ArgumentMetadata,
  BadRequestException,
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
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import type { InvoiceResponse } from './dto/invoice-response.dto.js';
import { InvoicesController } from './invoices.controller.js';
import {
  InvoicesService,
  requireIdempotencyKey,
} from './invoices.service.js';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '55555555-5555-4555-8555-555555555555';
const currentUser: CurrentUserContext = {
  id: '33333333-3333-4333-8333-333333333333',
  organizationId: '44444444-4444-4444-8444-444444444444',
  role: 'STAFF',
};

const invoiceResponse = {
  id: '66666666-6666-4666-8666-666666666666',
  invoiceNumber: 'INV-000001',
} as InvoiceResponse;

describe('InvoicesController', () => {
  const invoices = {
    createInvoice: vi.fn(),
  };

  async function controller(): Promise<InvoicesController> {
    const module = await Test.createTestingModule({
      controllers: [InvoicesController],
      providers: [
        { provide: InvoicesService, useValue: invoices },
        { provide: TokenService, useValue: { verifyAccessToken: vi.fn() } },
        {
          provide: PrismaService,
          useValue: { userServicePermission: { findMany: vi.fn() } },
        },
        Reflector,
      ],
    }).compile();
    return module.get(InvoicesController);
  }

  beforeEach(() => {
    invoices.createInvoice.mockReset().mockResolvedValue(invoiceResponse);
  });

  it('requires an authenticated user with the BILLING permission', () => {
    expect(Reflect.getMetadata(PATH_METADATA, InvoicesController)).toBe(
      'invoices',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, InvoicesController)).toEqual([
      AccessTokenGuard,
      ServicePermissionGuard,
    ]);
    expect(
      Reflect.getMetadata(SERVICE_PERMISSION_KEY, InvoicesController),
    ).toEqual(['BILLING']);
    expect(Reflect.getMetadata(ROLES_KEY, InvoicesController)).toBeUndefined();
  });

  it('delegates POST /invoices with the authenticated user and idempotency key', async () => {
    const dto = {
      items: [{ productId: PRODUCT_ID, quantity: '1' }],
      paymentMethod: 'CASH' as const,
    };

    await expect(
      (await controller()).create(dto, currentUser, '  sale-1  '),
    ).resolves.toEqual(invoiceResponse);
    expect(invoices.createInvoice).toHaveBeenCalledWith(
      dto,
      currentUser,
      'sale-1',
    );
    expect(
      Reflect.getMetadata(PATH_METADATA, InvoicesController.prototype.create),
    ).toBe('/');
    expect(
      Reflect.getMetadata(METHOD_METADATA, InvoicesController.prototype.create),
    ).toBe(RequestMethod.POST);
  });

  it('rejects a missing or blank idempotency key before calling the service', async () => {
    const dto = {
      items: [{ productId: PRODUCT_ID, quantity: '1' }],
      paymentMethod: 'CASH' as const,
    };
    const route = await controller();

    await expect(async () => {
      await route.create(dto, currentUser);
    }).rejects.toMatchObject({
      status: 400,
      message: 'Idempotency key is required.',
    });
    await expect(async () => {
      await route.create(dto, currentUser, '   ');
    }).rejects.toBeInstanceOf(BadRequestException);
    expect(invoices.createInvoice).not.toHaveBeenCalled();
  });
});

describe('CreateInvoiceDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: CreateInvoiceDto,
  };
  const valid = {
    customerId: CUSTOMER_ID,
    items: [{ productId: PRODUCT_ID, quantity: '1.500' }],
    paymentMethod: 'UPI',
    transactionRef: 'UPI-1',
  };

  it('accepts a walk-in sale and an optional customer', async () => {
    const walkIn = (await pipe.transform(
      {
        items: [{ productId: PRODUCT_ID, quantity: '1' }],
        paymentMethod: 'CASH',
      },
      metadata,
    )) as CreateInvoiceDto;
    const withCustomer = (await pipe.transform(
      valid,
      metadata,
    )) as CreateInvoiceDto;

    expect(walkIn.customerId).toBeUndefined();
    expect(walkIn.items[0]).toEqual({
      productId: PRODUCT_ID,
      quantity: '1',
    });
    expect(walkIn.paymentMethod).toBe('CASH');
    expect(withCustomer.customerId).toBe(CUSTOMER_ID);
    expect(withCustomer.transactionRef).toBe('UPI-1');
  });

  it('rejects missing, empty, or invalid items and payment methods', async () => {
    await expect(
      pipe.transform({ paymentMethod: 'CASH' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ items: [], paymentMethod: 'CASH' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        { items: [{ quantity: '1' }], paymentMethod: 'CASH' },
        metadata,
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        {
          items: [{ productId: 'product', quantity: '1' }],
          paymentMethod: 'CASH',
        },
        metadata,
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        {
          items: [{ productId: PRODUCT_ID, quantity: '0' }],
          paymentMethod: 'CASH',
        },
        metadata,
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        {
          items: [{ productId: PRODUCT_ID, quantity: '-1' }],
          paymentMethod: 'CASH',
        },
        metadata,
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        {
          items: [{ productId: PRODUCT_ID, quantity: '1.0001' }],
          paymentMethod: 'CASH',
        },
        metadata,
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        {
          customerId: 'customer',
          items: [{ productId: PRODUCT_ID, quantity: '1' }],
          paymentMethod: 'CASH',
        },
        metadata,
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        {
          items: [{ productId: PRODUCT_ID, quantity: '1' }],
          paymentMethod: 'CHEQUE',
        },
        metadata,
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        {
          items: [{ productId: PRODUCT_ID, quantity: '1' }],
          paymentMethod: 'CASH',
          transactionRef: '',
        },
        metadata,
      ),
    ).rejects.toBeDefined();
  });

  it('leaves duplicate product ids for the service to reject', async () => {
    const dto = (await pipe.transform(
      {
        items: [
          { productId: PRODUCT_ID, quantity: '1' },
          { productId: PRODUCT_ID, quantity: '2' },
        ],
        paymentMethod: 'CARD',
      },
      metadata,
    )) as CreateInvoiceDto;

    expect(dto.items).toHaveLength(2);
  });

  it('rejects server-owned invoice, price, tax, stock, and actor fields', async () => {
    const forbidden = [
      'invoiceNumber',
      'status',
      'paymentStatus',
      'createdById',
      'subtotal',
      'discountAmount',
      'taxableAmount',
      'cgstAmount',
      'sgstAmount',
      'igstAmount',
      'totalTax',
      'grandTotal',
      'previousStock',
      'newStock',
      'referenceType',
      'referenceId',
      'id',
      'issuedAt',
      'createdAt',
    ];
    for (const field of forbidden) {
      await expect(
        pipe.transform({ ...valid, [field]: '1' }, metadata),
      ).rejects.toBeDefined();
    }
    await expect(
      pipe.transform(
        {
          ...valid,
          items: [
            {
              productId: PRODUCT_ID,
              quantity: '1',
              unitPrice: '10',
              gstRate: '18',
              productName: 'Ladoo',
            },
          ],
        },
        metadata,
      ),
    ).rejects.toBeDefined();
  });
});

describe('requireIdempotencyKey', () => {
  it('returns the trimmed header and rejects values that are not a string', () => {
    expect(requireIdempotencyKey(' sale-1 ')).toBe('sale-1');
    expect(() => requireIdempotencyKey(undefined)).toThrow(BadRequestException);
    expect(() => requireIdempotencyKey(['sale-1'])).toThrow(
      BadRequestException,
    );
  });
});

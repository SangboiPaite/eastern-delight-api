import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { CurrentUserContext } from '../auth/current-user.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import { InvoicesService } from './invoices.service.js';

const PRODUCT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const KEY = 'sale-key-1';
const CREATED_AT = new Date('2026-03-01T00:00:00.000Z');

type ProductSeed = {
  id?: string;
  name?: string;
  sellingPrice?: string;
  gstRate?: string;
  stockQty?: string;
  isActive?: boolean;
};

type CustomerSeed = {
  id: string;
  name: string;
  mobile: string;
  address: string | null;
  gstin: string | null;
  state: string | null;
  stateCode: string | null;
};

type FailPoint =
  | 'sequence'
  | 'invoice'
  | 'item'
  | 'stock'
  | 'movement'
  | 'payment';

type HarnessOptions = {
  products?: Record<string, ProductSeed | null>;
  customer?: CustomerSeed | null;
  profiles?: Array<Record<string, unknown>>;
  sequence?: number;
  stockCounts?: number[];
  fail?: FailPoint;
  invoiceError?: unknown;
  paymentError?: unknown;
};

function actor(): CurrentUserContext {
  return {
    id: USER_ID,
    organizationId: '44444444-4444-4444-8444-444444444444',
    role: 'STAFF',
  };
}

function sellerProfile(prefix = 'INV-') {
  return {
    businessName: 'Eastern Delight',
    gstin: '27AAAAA0000A1Z5',
    address: 'Market Road',
    state: 'Maharashtra',
    stateCode: '27',
    mobile: '9000000000',
    email: 'billing@example.com',
    invoicePrefix: prefix,
  };
}

function customerSeed(overrides: Partial<CustomerSeed> = {}): CustomerSeed {
  return {
    id: CUSTOMER_ID,
    name: 'Asha',
    mobile: '9111111111',
    address: 'Hill Street',
    gstin: '29BBBBB0000B1Z5',
    state: 'Karnataka',
    stateCode: '29',
    ...overrides,
  };
}

function saleDto(overrides: Partial<CreateInvoiceDto> = {}): CreateInvoiceDto {
  return {
    items: [{ productId: PRODUCT_A, quantity: '2' }],
    paymentMethod: 'CASH',
    ...overrides,
  };
}

function sqlParts(query: unknown): { text: string; values: unknown[] } {
  const sql = query as { strings?: string[]; values?: unknown[] };
  return {
    text: (sql.strings ?? []).join(' '),
    values: [...(sql.values ?? [])],
  };
}

function decimalEq(value: unknown, expected: string): void {
  const text =
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    'toString' in value
      ? String(value)
      : String(value);
  expect(new Prisma.Decimal(text).eq(expected)).toBe(true);
}

function uniqueError(modelName: string, field: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on the fields: (\`${field}\`)`,
    {
      code: 'P2002',
      clientVersion: '7.10.0',
      meta: { modelName, target: [field] },
    },
  );
}

describe('InvoicesService', () => {
  const stored = new Map<
    string,
    { scope: string; responseHash: string | null }
  >();
  const prisma = {
    $transaction: vi.fn(),
    idempotencyKey: {
      findUnique: vi.fn(),
    },
  };
  const service = new InvoicesService(prisma as unknown as PrismaService);
  let calls: string[];
  let committedInvoices: number;
  let invoiceAttempts: number;
  let serial: number;
  let lastTx: ReturnType<typeof createTx>;

  function defaultProduct(id: string, seed?: ProductSeed) {
    return {
      id,
      name: id === PRODUCT_B ? 'Barfi' : 'Ladoo',
      sellingPrice: '100.00',
      gstRate: '18.00',
      stockQty: '10.000',
      isActive: true,
      ...seed,
    };
  }

  function createTx(options: HarnessOptions, markInvoice: () => void) {
    const stockCounts = [...(options.stockCounts ?? [])];
    const tx = {
      idempotencyKey: {
        findUnique: vi.fn(
          async (args: { where: { key: string } }) =>
            stored.get(args.where.key) ?? null,
        ),
        create: vi.fn(async (args: { data: { key: string; scope: string; responseHash: string | null } }) => {
          calls.push('idempotency');
          if (stored.has(args.data.key)) {
            throw uniqueError('IdempotencyKey', 'key');
          }
          stored.set(args.data.key, {
            scope: args.data.scope,
            responseHash: args.data.responseHash,
          });
          return args.data;
        }),
      },
      businessProfile: {
        findMany: vi.fn(async () => {
          calls.push('profile');
          return options.profiles ?? [sellerProfile()];
        }),
      },
      customer: {
        findUnique: vi.fn(async () => {
          calls.push('customer');
          return options.customer === undefined
            ? customerSeed()
            : options.customer;
        }),
      },
      $queryRaw: vi.fn(async (query: unknown) => {
        const sql = sqlParts(query);
        if (sql.text.includes('NumberSequence')) {
          calls.push('sequence');
          if (options.fail === 'sequence') {
            throw new Error('database unavailable');
          }
          return [{ currentValue: options.sequence ?? 1 }];
        }
        const productId = String(sql.values[0]);
        calls.push(`lock:${productId}`);
        const seed = options.products?.[productId];
        if (seed === null) {
          return [];
        }
        return [defaultProduct(productId, seed)];
      }),
      invoice: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          calls.push('invoice');
          invoiceAttempts += 1;
          if (options.invoiceError) {
            throw options.invoiceError;
          }
          if (options.fail === 'invoice') {
            throw new Error('database unavailable');
          }
          serial += 1;
          markInvoice();
          return {
            ...args.data,
            id: `invoice-${serial}`,
            createdAt: CREATED_AT,
          };
        }),
      },
      invoiceItem: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          calls.push('item');
          if (options.fail === 'item') {
            throw new Error('database unavailable');
          }
          serial += 1;
          return { ...args.data, id: `item-${serial}` };
        }),
      },
      product: {
        updateMany: vi.fn(
          async (args: { where: { id: string }; data: { stockQty: unknown } }) => {
            calls.push(`stock:${args.where.id}`);
            if (options.fail === 'stock') {
              throw new Error('database unavailable');
            }
            return { count: stockCounts.shift() ?? 1 };
          },
        ),
      },
      inventoryMovement: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          calls.push('movement');
          if (options.fail === 'movement') {
            throw new Error('database unavailable');
          }
          return args.data;
        }),
      },
      payment: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          calls.push('payment');
          if (options.paymentError) {
            throw options.paymentError;
          }
          if (options.fail === 'payment') {
            throw new Error('database unavailable');
          }
          serial += 1;
          return { ...args.data, id: `payment-${serial}` };
        }),
      },
    };
    return tx;
  }

  function install(options: HarnessOptions = {}) {
    calls = [];
    committedInvoices = 0;
    invoiceAttempts = 0;
    prisma.$transaction.mockClear();
    prisma.idempotencyKey.findUnique.mockImplementation(
      async (args: { where: { key: string } }) =>
        stored.get(args.where.key) ?? null,
    );
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof lastTx) => Promise<unknown>) => {
        let createdInvoice = false;
        const tx = createTx(options, () => {
          createdInvoice = true;
        });
        lastTx = tx;
        const result = await fn(tx);
        if (createdInvoice) {
          committedInvoices += 1;
        }
        return result;
      },
    );
  }

  beforeEach(() => {
    stored.clear();
    serial = 0;
    install({
      products: {
        [PRODUCT_A]: {
          sellingPrice: '80.25',
          gstRate: '5.00',
          stockQty: '10.000',
        },
      },
    });
  });

  function invoiceData(): { data: Record<string, unknown>; select: object } {
    return lastTx.invoice.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
      select: object;
    };
  }

  function itemData(index = 0): { data: Record<string, unknown>; select: object } {
    return lastTx.invoiceItem.create.mock.calls[index]?.[0] as {
      data: Record<string, unknown>;
      select: object;
    };
  }

  function movementData(index = 0): { data: Record<string, unknown> } {
    return lastTx.inventoryMovement.create.mock.calls[index]?.[0] as {
      data: Record<string, unknown>;
    };
  }

  function paymentData(): { data: Record<string, unknown>; select: object } {
    return lastTx.payment.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
      select: object;
    };
  }

  function stockData(index = 0): {
    where: { id: string; stockQty: { toString(): string } };
    data: { stockQty: { toString(): string } };
  } {
    return lastTx.product.updateMany.mock.calls[index]?.[0] as {
      where: { id: string; stockQty: { toString(): string } };
      data: { stockQty: { toString(): string } };
    };
  }

  it('creates a walk-in issued invoice from server prices and intra-state GST', async () => {
    const result = await service.createInvoice(saleDto(), actor(), KEY);

    expect(calls).toEqual([
      'profile',
      `lock:${PRODUCT_A}`,
      'sequence',
      'invoice',
      'item',
      `stock:${PRODUCT_A}`,
      'movement',
      'payment',
      'idempotency',
    ]);
    expect(lastTx.customer.findUnique).not.toHaveBeenCalled();
    expect(result.invoiceNumber).toBe('INV-000001');
    expect(result.status).toBe('ISSUED');
    expect(result.paymentStatus).toBe('PAID');
    expect(result.customerId).toBeNull();
    expect(result.customerNameSnapshot).toBeNull();
    expect(result.customerStateCodeSnapshot).toBeNull();
    expect(result.createdById).toBe(USER_ID);
    expect(result.sellerName).toBe('Eastern Delight');
    expect(result.sellerGstin).toBe('27AAAAA0000A1Z5');
    expect(result.sellerStateCode).toBe('27');
    expect(result.sellerMobile).toBe('9000000000');
    expect(result.issuedAt).toBeInstanceOf(Date);
    expect(result.createdAt).toEqual(CREATED_AT);
    decimalEq(result.subtotal, '160.5');
    decimalEq(result.discountAmount, '0');
    decimalEq(result.taxableAmount, '160.5');
    decimalEq(result.cgstAmount, '4.02');
    decimalEq(result.sgstAmount, '4.01');
    decimalEq(result.igstAmount, '0');
    decimalEq(result.totalTax, '8.03');
    decimalEq(result.grandTotal, '168.53');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.productName).toBe('Ladoo');
    decimalEq(result.items[0]?.unitPrice, '80.25');
    decimalEq(result.items[0]?.gstRate, '5');
    decimalEq(result.items[0]?.quantity, '2');
    decimalEq(result.items[0]?.taxableAmount, '160.5');
    decimalEq(result.items[0]?.totalAmount, '168.53');
    decimalEq(result.payment.amount, '168.53');
    expect(result.payment.method).toBe('CASH');
    expect(result.payment.status).toBe('PAID');
    expect(result.payment.transactionRef).toBeNull();
    expect(result.payment.paidAt).toEqual(result.issuedAt);
    expect(result).not.toHaveProperty('createdBy');
    expect(result.items[0]).not.toHaveProperty('product');
    expect(JSON.stringify(result)).not.toContain('categoryId');

    decimalEq(invoiceData().data.subtotal, '160.5');
    decimalEq(itemData().data.unitPrice, '80.25');
    decimalEq(itemData().data.gstRate, '5');
    expect(invoiceData().select).not.toHaveProperty('customer');
    expect(invoiceData().select).not.toHaveProperty('items');
    expect(itemData().select).not.toHaveProperty('product');
    decimalEq(stockData().where.stockQty, '10');
    decimalEq(stockData().data.stockQty, '8');
    expect(movementData().data).toMatchObject({
      productId: PRODUCT_A,
      type: 'SALE',
      referenceType: 'INVOICE',
      referenceId: result.id,
      createdById: USER_ID,
    });
    decimalEq(movementData().data.quantity, '2');
    decimalEq(movementData().data.previousStock, '10');
    decimalEq(movementData().data.newStock, '8');
    expect(movementData().data).not.toHaveProperty('note');
    decimalEq(paymentData().data.amount, result.grandTotal);
    expect(paymentData().data.paidAt).toEqual(result.issuedAt);
    expect(committedInvoices).toBe(1);

    const sequence = sqlParts(lastTx.$queryRaw.mock.calls[1]?.[0]);
    expect(sequence.text).toContain('INSERT INTO "NumberSequence"');
    expect(sequence.text).toContain('ON CONFLICT ("key") DO UPDATE');
    expect(sequence.text).toContain('"currentValue" = "NumberSequence"."currentValue" + 1');
    expect(sequence.values).toContain('INVOICE');
    const lock = sqlParts(lastTx.$queryRaw.mock.calls[0]?.[0]);
    expect(lock.text).toContain('FOR UPDATE');
    expect(lock.text).toContain('"stockQty"');
    expect(lock.values).toEqual([PRODUCT_A]);
  });

  it('copies the customer, charges IGST for another state, and stores the payment reference', async () => {
    install({
      customer: customerSeed(),
      products: {
        [PRODUCT_A]: { sellingPrice: '100.00', gstRate: '18.00' },
      },
    });

    const result = await service.createInvoice(
      saleDto({
        customerId: CUSTOMER_ID,
        items: [{ productId: PRODUCT_A, quantity: '1' }],
        paymentMethod: 'UPI',
        transactionRef: 'UPI-1',
      }),
      actor(),
      KEY,
    );

    expect(calls[0]).toBe('profile');
    expect(calls[1]).toBe('customer');
    expect(result.customerId).toBe(CUSTOMER_ID);
    expect(result.customerNameSnapshot).toBe('Asha');
    expect(result.customerMobileSnapshot).toBe('9111111111');
    expect(result.customerAddressSnapshot).toBe('Hill Street');
    expect(result.customerGstinSnapshot).toBe('29BBBBB0000B1Z5');
    expect(result.customerStateSnapshot).toBe('Karnataka');
    expect(result.customerStateCodeSnapshot).toBe('29');
    decimalEq(result.cgstAmount, '0');
    decimalEq(result.sgstAmount, '0');
    decimalEq(result.igstAmount, '18');
    decimalEq(result.grandTotal, '118');
    expect(result.payment.method).toBe('UPI');
    expect(result.payment.transactionRef).toBe('UPI-1');
    decimalEq(result.payment.amount, result.grandTotal);
    expect(invoiceData().data.customerId).toBe(CUSTOMER_ID);
  });

  it('splits GST inside the seller state, including a customer with no state code', async () => {
    install({
      customer: customerSeed({ state: 'Maharashtra', stateCode: '27' }),
      products: {
        [PRODUCT_A]: { sellingPrice: '100.00', gstRate: '18.00' },
      },
    });
    const intra = await service.createInvoice(
      saleDto({
        customerId: CUSTOMER_ID,
        items: [{ productId: PRODUCT_A, quantity: '1' }],
      }),
      actor(),
      'intra',
    );
    decimalEq(intra.cgstAmount, '9');
    decimalEq(intra.sgstAmount, '9');
    decimalEq(intra.igstAmount, '0');

    stored.clear();
    install({
      customer: customerSeed({ state: null, stateCode: null }),
      products: {
        [PRODUCT_A]: { sellingPrice: '100.00', gstRate: '18.00' },
      },
    });
    const walkInState = await service.createInvoice(
      saleDto({
        customerId: CUSTOMER_ID,
        items: [{ productId: PRODUCT_A, quantity: '1' }],
      }),
      actor(),
      'no-state',
    );
    decimalEq(walkInState.cgstAmount, '9');
    decimalEq(walkInState.sgstAmount, '9');
    decimalEq(walkInState.igstAmount, '0');
  });

  it('locks products in id order, rejects a repeated product, and totals every line', async () => {
    install({
      products: {
        [PRODUCT_A]: { sellingPrice: '100.00', gstRate: '18.00', stockQty: '4' },
        [PRODUCT_B]: { sellingPrice: '50.00', gstRate: '18.00', stockQty: '3' },
      },
    });

    await expect(
      service.createInvoice(
        saleDto({
          items: [
            { productId: PRODUCT_B, quantity: '1' },
            { productId: PRODUCT_B.toUpperCase(), quantity: '1' },
          ],
        }),
        actor(),
        KEY,
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Duplicate product in the same invoice.',
    });
    expect(lastTx.$queryRaw).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);

    const result = await service.createInvoice(
      saleDto({
        items: [
          { productId: PRODUCT_B, quantity: '1' },
          { productId: PRODUCT_A, quantity: '1' },
        ],
      }),
      actor(),
      KEY,
    );

    expect(calls.filter((call) => call.startsWith('lock:'))).toEqual([
      `lock:${PRODUCT_A}`,
      `lock:${PRODUCT_B}`,
    ]);
    expect(result.items.map((item) => item.productId)).toEqual([
      PRODUCT_B,
      PRODUCT_A,
    ]);
    decimalEq(result.taxableAmount, '150');
    decimalEq(result.cgstAmount, '13.5');
    decimalEq(result.sgstAmount, '13.5');
    decimalEq(result.grandTotal, '177');
    expect(calls.filter((call) => call.startsWith('stock:'))).toEqual([
      `stock:${PRODUCT_A}`,
      `stock:${PRODUCT_B}`,
    ]);
    expect(movementData(0).data.productId).toBe(PRODUCT_B);
    expect(movementData(1).data.productId).toBe(PRODUCT_A);
    decimalEq(stockData(0).data.stockQty, '3');
    decimalEq(stockData(1).data.stockQty, '2');
  });

  it('formats the next sequence value with the business invoice prefix', async () => {
    install({
      profiles: [sellerProfile('BILL-')],
      sequence: 42,
      products: { [PRODUCT_A]: { sellingPrice: '10', gstRate: '0' } },
    });

    const result = await service.createInvoice(
      saleDto({ items: [{ productId: PRODUCT_A, quantity: '2.500' }] }),
      actor(),
      KEY,
    );

    expect(result.invoiceNumber).toBe('BILL-000042');
    decimalEq(movementData().data.previousStock, '10');
    decimalEq(movementData().data.newStock, '7.5');
    decimalEq(movementData().data.quantity, '2.5');
    expect(lastTx.businessProfile.findMany).toHaveBeenCalledWith({
      select: {
        businessName: true,
        gstin: true,
        address: true,
        state: true,
        stateCode: true,
        mobile: true,
        email: true,
        invoicePrefix: true,
      },
      take: 2,
    });
  });

  it('returns 404 when the customer or a product does not exist', async () => {
    install({ customer: null });
    await expect(
      service.createInvoice(saleDto({ customerId: CUSTOMER_ID }), actor(), KEY),
    ).rejects.toMatchObject({ status: 404, message: 'Customer not found.' });
    expect(lastTx.$queryRaw).not.toHaveBeenCalled();
    await expect(
      service.createInvoice(saleDto({ customerId: CUSTOMER_ID }), actor(), KEY),
    ).rejects.toBeInstanceOf(NotFoundException);

    install({ products: { [PRODUCT_A]: null } });
    await expect(
      service.createInvoice(saleDto(), actor(), KEY),
    ).rejects.toMatchObject({ status: 404, message: 'Product not found.' });
    expect(lastTx.invoice.create).not.toHaveBeenCalled();
  });

  it('returns 409 when a product is inactive or stock cannot cover the sale', async () => {
    install({ products: { [PRODUCT_A]: { isActive: false } } });
    await expect(
      service.createInvoice(saleDto(), actor(), KEY),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Product is not active.',
    });
    expect(lastTx.product.updateMany).not.toHaveBeenCalled();
    expect(calls).not.toContain('sequence');

    install({ products: { [PRODUCT_A]: { stockQty: '1.000' } } });
    await expect(
      service.createInvoice(saleDto(), actor(), KEY),
    ).rejects.toMatchObject({ status: 409, message: 'Insufficient stock.' });
    expect(lastTx.product.updateMany).not.toHaveBeenCalled();
    expect(lastTx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('returns 409 when the conditional stock update matches no row', async () => {
    install({ stockCounts: [0] });

    await expect(
      service.createInvoice(saleDto(), actor(), KEY),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Stock changed before this sale could be recorded.',
    });
    expect(lastTx.inventoryMovement.create).not.toHaveBeenCalled();
    expect(committedInvoices).toBe(0);
    expect(stored.size).toBe(0);
    await expect(
      service.createInvoice(saleDto(), actor(), KEY),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('treats a missing business profile as a server configuration error', async () => {
    install({ profiles: [] });
    await expect(
      service.createInvoice(saleDto(), actor(), KEY),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    install({ profiles: [sellerProfile(), sellerProfile()] });
    await expect(
      service.createInvoice(saleDto(), actor(), KEY),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(lastTx.invoice.create).not.toHaveBeenCalled();
  });

  it.each([
    ['sequence operation', 'sequence', 'invoice'],
    ['invoice creation', 'invoice', 'item'],
    ['invoice item creation', 'item', 'stock'],
    ['stock update', 'stock', 'movement'],
    ['SALE movement creation', 'movement', 'payment'],
    ['payment creation', 'payment', 'idempotency'],
  ] as const)(
    'rolls back the sale when %s fails',
    async (_name, fail, absent) => {
      install({ fail });

      await expect(
        service.createInvoice(saleDto(), actor(), KEY),
      ).rejects.toThrow('database unavailable');
      expect(committedInvoices).toBe(0);
      expect(stored.size).toBe(0);
      expect(
        calls.some(
          (call) => call === absent || call.startsWith(`${absent}:`),
        ),
      ).toBe(false);
    },
  );

  it('maps only an invoice-number collision to 409 and lets other unique errors propagate', async () => {
    install({ invoiceError: uniqueError('Invoice', 'invoiceNumber') });
    await expect(
      service.createInvoice(saleDto(), actor(), KEY),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Invoice number is already in use.',
    });
    expect(committedInvoices).toBe(0);

    install({
      paymentError: uniqueError('Payment', 'invoiceId'),
    });
    await expect(
      service.createInvoice(saleDto(), actor(), KEY),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(stored.size).toBe(0);
  });

  it('returns the stored invoice for the same idempotency key and does not sell twice', async () => {
    const first = await service.createInvoice(saleDto(), actor(), KEY);
    const second = await service.createInvoice(
      saleDto({ paymentMethod: 'CARD' }),
      actor(),
      KEY,
    );

    expect(second).toEqual(first);
    expect(second.payment.method).toBe('CASH');
    expect(invoiceAttempts).toBe(1);
    expect(committedInvoices).toBe(1);
    expect(stored.size).toBe(1);
  });

  it('does not commit a second invoice when a concurrent request loses the idempotency key', async () => {
    install();
    const [first, second] = await Promise.all([
      service.createInvoice(saleDto(), actor(), KEY),
      service.createInvoice(saleDto(), actor(), KEY),
    ]);

    expect(first).toEqual(second);
    expect(committedInvoices).toBe(1);
    expect(stored.size).toBe(1);
  });

  it('rejects an idempotency key that belongs to another scope', async () => {
    stored.set(KEY, { scope: 'OTHER', responseHash: null });

    await expect(
      service.createInvoice(saleDto(), actor(), KEY),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Idempotency key is already in use.',
    });
    expect(lastTx.invoice.create).not.toHaveBeenCalled();
  });

  it('rejects a blank idempotency key before opening a transaction', async () => {
    await expect(
      service.createInvoice(saleDto(), actor(), '  '),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Idempotency key is required.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

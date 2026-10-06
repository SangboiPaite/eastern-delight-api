import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  PaymentStatus,
  Prisma,
  type PrismaClient,
} from '../../generated/prisma/client.js';
import type { CurrentUserContext } from '../auth/current-user.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  CreateInvoiceDto,
  CreateInvoiceItemDto,
} from './dto/create-invoice.dto.js';
import type {
  InvoiceItemResponse,
  InvoicePaymentResponse,
  InvoiceResponse,
} from './dto/invoice-response.dto.js';

const INVOICE_SEQUENCE_KEY = 'INVOICE';
const INVOICE_SCOPE = 'INVOICE_CREATE';
const INVOICE_REFERENCE = 'INVOICE';
const INVOICE_NUMBER_WIDTH = 6;

const CUSTOMER_NOT_FOUND = 'Customer not found.';
const PRODUCT_NOT_FOUND = 'Product not found.';
const PRODUCT_NOT_ACTIVE = 'Product is not active.';
const DUPLICATE_PRODUCT = 'Duplicate product in the same invoice.';
const INSUFFICIENT_STOCK = 'Insufficient stock.';
const STOCK_CHANGED = 'Stock changed before this sale could be recorded.';
const IDEMPOTENCY_REQUIRED = 'Idempotency key is required.';
const IDEMPOTENCY_IN_USE = 'Idempotency key is already in use.';
const INVOICE_NUMBER_IN_USE = 'Invoice number is already in use.';
const ITEMS_REQUIRED = 'At least one invoice item is required.';

const SELLER_SELECT = {
  businessName: true,
  gstin: true,
  address: true,
  state: true,
  stateCode: true,
  mobile: true,
  email: true,
  invoicePrefix: true,
} as const;

const CUSTOMER_SELECT = {
  id: true,
  name: true,
  mobile: true,
  address: true,
  gstin: true,
  state: true,
  stateCode: true,
} as const;

const INVOICE_SELECT = {
  id: true,
  invoiceNumber: true,
  customerId: true,
  createdById: true,
  status: true,
  paymentMethod: true,
  paymentStatus: true,
  subtotal: true,
  discountAmount: true,
  taxableAmount: true,
  cgstAmount: true,
  sgstAmount: true,
  igstAmount: true,
  totalTax: true,
  grandTotal: true,
  sellerName: true,
  sellerGstin: true,
  sellerAddress: true,
  sellerState: true,
  sellerStateCode: true,
  sellerMobile: true,
  sellerEmail: true,
  customerNameSnapshot: true,
  customerMobileSnapshot: true,
  customerAddressSnapshot: true,
  customerGstinSnapshot: true,
  customerStateSnapshot: true,
  customerStateCodeSnapshot: true,
  issuedAt: true,
  createdAt: true,
} as const;

const ITEM_SELECT = {
  id: true,
  productId: true,
  productName: true,
  quantity: true,
  unitPrice: true,
  gstRate: true,
  taxableAmount: true,
  cgstAmount: true,
  sgstAmount: true,
  igstAmount: true,
  totalAmount: true,
} as const;

const PAYMENT_SELECT = {
  id: true,
  amount: true,
  method: true,
  status: true,
  transactionRef: true,
  paidAt: true,
} as const;

type Money = {
  toString(): string;
};

type SellerProfile = {
  businessName: string;
  gstin: string | null;
  address: string;
  state: string;
  stateCode: string;
  mobile: string | null;
  email: string | null;
  invoicePrefix: string;
};

type CustomerRecord = {
  id: string;
  name: string;
  mobile: string;
  address: string | null;
  gstin: string | null;
  state: string | null;
  stateCode: string | null;
};

type LockedProductRow = {
  id: string;
  name: string;
  sellingPrice: Prisma.Decimal | string | number;
  gstRate: Prisma.Decimal | string | number;
  stockQty: Prisma.Decimal | string | number;
  isActive: boolean;
};

type LockedProduct = {
  id: string;
  name: string;
  sellingPrice: Prisma.Decimal;
  gstRate: Prisma.Decimal;
  stockQty: Prisma.Decimal;
  isActive: boolean;
};

type SaleLine = {
  productId: string;
  productName: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  gstRate: Prisma.Decimal;
  taxableAmount: Prisma.Decimal;
  cgstAmount: Prisma.Decimal;
  sgstAmount: Prisma.Decimal;
  igstAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  previousStock: Prisma.Decimal;
  newStock: Prisma.Decimal;
};

type InvoiceTotals = {
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxableAmount: Prisma.Decimal;
  cgstAmount: Prisma.Decimal;
  sgstAmount: Prisma.Decimal;
  igstAmount: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
};

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  customerId: string | null;
  createdById: string;
  status: InvoiceResponse['status'];
  paymentMethod: InvoiceResponse['paymentMethod'];
  paymentStatus: InvoiceResponse['paymentStatus'];
  subtotal: Money;
  discountAmount: Money;
  taxableAmount: Money;
  cgstAmount: Money;
  sgstAmount: Money;
  igstAmount: Money;
  totalTax: Money;
  grandTotal: Money;
  sellerName: string;
  sellerGstin: string | null;
  sellerAddress: string;
  sellerState: string;
  sellerStateCode: string;
  sellerMobile: string | null;
  sellerEmail: string | null;
  customerNameSnapshot: string | null;
  customerMobileSnapshot: string | null;
  customerAddressSnapshot: string | null;
  customerGstinSnapshot: string | null;
  customerStateSnapshot: string | null;
  customerStateCodeSnapshot: string | null;
  issuedAt: Date | null;
  createdAt: Date;
};

type ItemRow = {
  id: string;
  productId: string;
  productName: string;
  quantity: Money;
  unitPrice: Money;
  gstRate: Money;
  taxableAmount: Money;
  cgstAmount: Money;
  sgstAmount: Money;
  igstAmount: Money;
  totalAmount: Money;
};

type PaymentRow = {
  id: string;
  amount: Money;
  method: InvoicePaymentResponse['method'];
  status: InvoicePaymentResponse['status'];
  transactionRef: string | null;
  paidAt: Date | null;
};

export function requireIdempotencyKey(header: unknown): string {
  if (typeof header !== 'string' || header.trim() === '') {
    throw new BadRequestException(IDEMPOTENCY_REQUIRED);
  }
  return header.trim();
}

function compareProductIds(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function assertUniqueProducts(items: CreateInvoiceItemDto[]): void {
  if (items.length === 0) {
    throw new BadRequestException(ITEMS_REQUIRED);
  }
  const seen = new Set<string>();
  for (const item of items) {
    const productId = item.productId.toLowerCase();
    if (seen.has(productId)) {
      throw new ConflictException(DUPLICATE_PRODUCT);
    }
    seen.add(productId);
  }
}

function money(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2);
}

function isIntraStateSale(
  sellerStateCode: string,
  customerStateCode: string | null,
): boolean {
  if (customerStateCode === null) {
    return true;
  }
  const customerCode = customerStateCode.trim();
  if (customerCode === '') {
    return true;
  }
  return customerCode === sellerStateCode.trim();
}

function calculateLine(
  product: LockedProduct,
  quantity: Prisma.Decimal,
  intraState: boolean,
): SaleLine {
  if (!quantity.gt(0)) {
    throw new ConflictException(INSUFFICIENT_STOCK);
  }
  const previousStock = product.stockQty;
  const newStock = previousStock.minus(quantity);
  if (newStock.lt(0)) {
    throw new ConflictException(INSUFFICIENT_STOCK);
  }

  const taxableAmount = money(quantity.mul(product.sellingPrice));
  const gst = money(taxableAmount.mul(product.gstRate).div(100));
  const zero = new Prisma.Decimal(0);
  const cgstAmount = intraState ? money(gst.div(2)) : zero;
  const sgstAmount = intraState ? gst.minus(cgstAmount) : zero;
  const igstAmount = intraState ? zero : gst;
  return {
    productId: product.id,
    productName: product.name,
    quantity,
    unitPrice: product.sellingPrice,
    gstRate: product.gstRate,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalAmount: taxableAmount.plus(cgstAmount).plus(sgstAmount).plus(igstAmount),
    previousStock,
    newStock,
  };
}

function sumMoney(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce(
    (total, value) => total.plus(value),
    new Prisma.Decimal(0),
  );
}

function calculateTotals(lines: SaleLine[]): InvoiceTotals {
  const subtotal = sumMoney(lines.map((line) => line.taxableAmount));
  const discountAmount = new Prisma.Decimal(0);
  const cgstAmount = sumMoney(lines.map((line) => line.cgstAmount));
  const sgstAmount = sumMoney(lines.map((line) => line.sgstAmount));
  const igstAmount = sumMoney(lines.map((line) => line.igstAmount));
  const totalTax = cgstAmount.plus(sgstAmount).plus(igstAmount);
  return {
    subtotal,
    discountAmount,
    taxableAmount: subtotal.minus(discountAmount),
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalTax,
    grandTotal: subtotal.minus(discountAmount).plus(totalTax),
  };
}

function formatInvoiceNumber(prefix: string, sequence: number): string {
  return `${prefix}${sequence.toString().padStart(INVOICE_NUMBER_WIDTH, '0')}`;
}

function text(value: Money): string {
  return value.toString();
}

function toInvoiceResponse(
  invoice: InvoiceRow,
  items: ItemRow[],
  payment: PaymentRow,
): InvoiceResponse {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customerId: invoice.customerId,
    createdById: invoice.createdById,
    status: invoice.status,
    paymentMethod: invoice.paymentMethod,
    paymentStatus: invoice.paymentStatus,
    subtotal: text(invoice.subtotal),
    discountAmount: text(invoice.discountAmount),
    taxableAmount: text(invoice.taxableAmount),
    cgstAmount: text(invoice.cgstAmount),
    sgstAmount: text(invoice.sgstAmount),
    igstAmount: text(invoice.igstAmount),
    totalTax: text(invoice.totalTax),
    grandTotal: text(invoice.grandTotal),
    sellerName: invoice.sellerName,
    sellerGstin: invoice.sellerGstin,
    sellerAddress: invoice.sellerAddress,
    sellerState: invoice.sellerState,
    sellerStateCode: invoice.sellerStateCode,
    sellerMobile: invoice.sellerMobile,
    sellerEmail: invoice.sellerEmail,
    customerNameSnapshot: invoice.customerNameSnapshot,
    customerMobileSnapshot: invoice.customerMobileSnapshot,
    customerAddressSnapshot: invoice.customerAddressSnapshot,
    customerGstinSnapshot: invoice.customerGstinSnapshot,
    customerStateSnapshot: invoice.customerStateSnapshot,
    customerStateCodeSnapshot: invoice.customerStateCodeSnapshot,
    issuedAt: invoice.issuedAt,
    createdAt: invoice.createdAt,
    items: items.map(
      (item): InvoiceItemResponse => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        quantity: text(item.quantity),
        unitPrice: text(item.unitPrice),
        gstRate: text(item.gstRate),
        taxableAmount: text(item.taxableAmount),
        cgstAmount: text(item.cgstAmount),
        sgstAmount: text(item.sgstAmount),
        igstAmount: text(item.igstAmount),
        totalAmount: text(item.totalAmount),
      }),
    ),
    payment: {
      id: payment.id,
      amount: text(payment.amount),
      method: payment.method,
      status: payment.status,
      transactionRef: payment.transactionRef,
      paidAt: payment.paidAt,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseStoredInvoice(responseHash: string): InvoiceResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseHash);
  } catch {
    throw new ConflictException(IDEMPOTENCY_IN_USE);
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.id !== 'string' ||
    typeof parsed.invoiceNumber !== 'string' ||
    !Array.isArray(parsed.items) ||
    !isRecord(parsed.payment)
  ) {
    throw new ConflictException(IDEMPOTENCY_IN_USE);
  }
  const invoice = parsed as unknown as InvoiceResponse;
  return {
    ...invoice,
    issuedAt: invoice.issuedAt ? new Date(invoice.issuedAt) : null,
    createdAt: new Date(invoice.createdAt),
    payment: {
      ...invoice.payment,
      paidAt: invoice.payment.paidAt ? new Date(invoice.payment.paidAt) : null,
    },
  };
}

function isUniqueConflict(
  error: unknown,
  modelName: string,
  field: string,
): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const model = error.meta?.modelName;
  if (model !== undefined && model !== modelName) {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.includes(field);
  }
  return typeof target === 'string' && target.includes(field);
}

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async createInvoice(
    dto: CreateInvoiceDto,
    currentUser: CurrentUserContext,
    idempotencyKey: string,
  ): Promise<InvoiceResponse> {
    const key = requireIdempotencyKey(idempotencyKey);
    try {
      return await this.prisma.$transaction((tx) =>
        this.issueInvoice(
          tx as unknown as PrismaClient,
          dto,
          currentUser,
          key,
        ),
      );
    } catch (error) {
      if (isUniqueConflict(error, 'IdempotencyKey', 'key')) {
        const replay = await this.readReplay(this.prisma, key);
        if (replay) {
          return replay;
        }
        throw new ConflictException(IDEMPOTENCY_IN_USE);
      }
      if (isUniqueConflict(error, 'Invoice', 'invoiceNumber')) {
        throw new ConflictException(INVOICE_NUMBER_IN_USE);
      }
      throw error;
    }
  }

  private async issueInvoice(
    tx: PrismaClient,
    dto: CreateInvoiceDto,
    currentUser: CurrentUserContext,
    key: string,
  ): Promise<InvoiceResponse> {
    const replay = await this.readReplay(tx, key);
    if (replay) {
      return replay;
    }

    assertUniqueProducts(dto.items);
    const seller = await this.readSeller(tx);
    const customer = dto.customerId
      ? await this.readCustomer(tx, dto.customerId)
      : null;
    const intraState = isIntraStateSale(
      seller.stateCode,
      customer?.stateCode ?? null,
    );

    const lockOrder = [...dto.items].sort((left, right) =>
      compareProductIds(left.productId, right.productId),
    );
    const locked = new Map<string, LockedProduct>();
    for (const item of lockOrder) {
      locked.set(
        item.productId.toLowerCase(),
        await this.lockProduct(tx, item.productId),
      );
    }

    const lines = dto.items.map((item) => {
      const product = locked.get(item.productId.toLowerCase());
      if (!product) {
        throw new NotFoundException(PRODUCT_NOT_FOUND);
      }
      if (!product.isActive) {
        throw new ConflictException(PRODUCT_NOT_ACTIVE);
      }
      return calculateLine(product, new Prisma.Decimal(item.quantity), intraState);
    });
    const totals = calculateTotals(lines);
    const sequence = await this.allocateInvoiceSequence(tx);
    const invoiceNumber = formatInvoiceNumber(seller.invoicePrefix, sequence);
    const issuedAt = new Date();

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        customerId: customer?.id ?? null,
        createdById: currentUser.id,
        status: InvoiceStatus.ISSUED,
        paymentMethod: dto.paymentMethod,
        paymentStatus: PaymentStatus.PAID,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxableAmount: totals.taxableAmount,
        cgstAmount: totals.cgstAmount,
        sgstAmount: totals.sgstAmount,
        igstAmount: totals.igstAmount,
        totalTax: totals.totalTax,
        grandTotal: totals.grandTotal,
        sellerName: seller.businessName,
        sellerGstin: seller.gstin,
        sellerAddress: seller.address,
        sellerState: seller.state,
        sellerStateCode: seller.stateCode,
        sellerMobile: seller.mobile,
        sellerEmail: seller.email,
        customerNameSnapshot: customer?.name ?? null,
        customerMobileSnapshot: customer?.mobile ?? null,
        customerAddressSnapshot: customer?.address ?? null,
        customerGstinSnapshot: customer?.gstin ?? null,
        customerStateSnapshot: customer?.state ?? null,
        customerStateCodeSnapshot: customer?.stateCode ?? null,
        issuedAt,
      },
      select: INVOICE_SELECT,
    });

    const items: ItemRow[] = [];
    for (const line of lines) {
      items.push(
        await tx.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            productId: line.productId,
            productName: line.productName,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            gstRate: line.gstRate,
            taxableAmount: line.taxableAmount,
            cgstAmount: line.cgstAmount,
            sgstAmount: line.sgstAmount,
            igstAmount: line.igstAmount,
            totalAmount: line.totalAmount,
          },
          select: ITEM_SELECT,
        }),
      );
    }

    const stockOrder = [...lines].sort((left, right) =>
      compareProductIds(left.productId, right.productId),
    );
    for (const line of stockOrder) {
      const updated = await tx.product.updateMany({
        where: { id: line.productId, stockQty: line.previousStock },
        data: { stockQty: line.newStock },
      });
      if (updated.count !== 1) {
        throw new ConflictException(STOCK_CHANGED);
      }
    }

    for (const line of lines) {
      await tx.inventoryMovement.create({
        data: {
          productId: line.productId,
          type: 'SALE',
          quantity: line.quantity,
          previousStock: line.previousStock,
          newStock: line.newStock,
          referenceType: INVOICE_REFERENCE,
          referenceId: invoice.id,
          createdById: currentUser.id,
        },
      });
    }

    const payment = await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: totals.grandTotal,
        method: dto.paymentMethod,
        status: PaymentStatus.PAID,
        transactionRef: dto.transactionRef ?? null,
        paidAt: issuedAt,
      },
      select: PAYMENT_SELECT,
    });

    const response = toInvoiceResponse(invoice, items, payment);
    await tx.idempotencyKey.create({
      data: {
        key,
        scope: INVOICE_SCOPE,
        responseHash: JSON.stringify(response),
      },
    });
    return response;
  }

  private async readReplay(
    db: PrismaClient,
    key: string,
  ): Promise<InvoiceResponse | null> {
    const existing = await db.idempotencyKey.findUnique({
      where: { key },
      select: { scope: true, responseHash: true },
    });
    if (!existing) {
      return null;
    }
    if (existing.scope !== INVOICE_SCOPE || existing.responseHash == null) {
      throw new ConflictException(IDEMPOTENCY_IN_USE);
    }
    return parseStoredInvoice(existing.responseHash);
  }

  private async readSeller(tx: PrismaClient): Promise<SellerProfile> {
    const profiles = await tx.businessProfile.findMany({
      select: SELLER_SELECT,
      take: 2,
    });
    if (profiles.length !== 1) {
      throw new InternalServerErrorException();
    }
    return profiles[0];
  }

  private async readCustomer(
    tx: PrismaClient,
    customerId: string,
  ): Promise<CustomerRecord> {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: CUSTOMER_SELECT,
    });
    if (!customer) {
      throw new NotFoundException(CUSTOMER_NOT_FOUND);
    }
    return customer;
  }

  private async lockProduct(
    tx: PrismaClient,
    productId: string,
  ): Promise<LockedProduct> {
    const rows = await tx.$queryRaw<LockedProductRow[]>(
      Prisma.sql`SELECT id, name, "sellingPrice", "gstRate", "stockQty", "isActive" FROM "Product" WHERE id = CAST(${productId} AS uuid) FOR UPDATE`,
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException(PRODUCT_NOT_FOUND);
    }
    return {
      id: row.id,
      name: row.name,
      sellingPrice: new Prisma.Decimal(row.sellingPrice),
      gstRate: new Prisma.Decimal(row.gstRate),
      stockQty: new Prisma.Decimal(row.stockQty),
      isActive: row.isActive,
    };
  }

  private async allocateInvoiceSequence(tx: PrismaClient): Promise<number> {
    // Insert-or-increment is one statement, so concurrent sales serialize on the unique key.
    const rows = await tx.$queryRaw<Array<{ currentValue: number | bigint }>>(
      Prisma.sql`
        INSERT INTO "NumberSequence" ("id", "key", "currentValue", "updatedAt")
        VALUES (CAST(${randomUUID()} AS uuid), ${INVOICE_SEQUENCE_KEY}, 1, NOW())
        ON CONFLICT ("key") DO UPDATE
        SET "currentValue" = "NumberSequence"."currentValue" + 1,
            "updatedAt" = NOW()
        RETURNING "currentValue"
      `,
    );
    const sequence = Number(rows[0]?.currentValue);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new InternalServerErrorException();
    }
    return sequence;
  }
}

import type {
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../../generated/prisma/client.js';

export type InvoiceItemResponse = {
  id: string;
  productId: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  gstRate: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  totalAmount: string;
};

export type InvoicePaymentResponse = {
  id: string;
  amount: string;
  method: PaymentMethod;
  status: PaymentStatus;
  transactionRef: string | null;
  paidAt: Date | null;
};

export type InvoiceResponse = {
  id: string;
  invoiceNumber: string;
  customerId: string | null;
  createdById: string;
  status: InvoiceStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  subtotal: string;
  discountAmount: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  totalTax: string;
  grandTotal: string;
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
  items: InvoiceItemResponse[];
  payment: InvoicePaymentResponse;
};

import {
  Body,
  Controller,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import type { CurrentUserContext } from '../auth/current-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RequireService } from '../auth/service-permission.decorator.js';
import { ServicePermissionGuard } from '../auth/service-permission.guard.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import type { InvoiceResponse } from './dto/invoice-response.dto.js';
import {
  InvoicesService,
  requireIdempotencyKey,
} from './invoices.service.js';

@Controller('invoices')
@UseGuards(AccessTokenGuard, ServicePermissionGuard)
@RequireService('BILLING')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post()
  create(
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() currentUser: CurrentUserContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<InvoiceResponse> {
    return this.invoices.createInvoice(
      dto,
      currentUser,
      requireIdempotencyKey(idempotencyKey),
    );
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import type { CurrentUserContext } from '../auth/current-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RequireService } from '../auth/service-permission.decorator.js';
import { ServicePermissionGuard } from '../auth/service-permission.guard.js';
import { CreateInventoryMovementDto } from './dto/create-inventory-movement.dto.js';
import type {
  InventoryMovementListResponse,
  InventoryMovementResponse,
} from './dto/inventory-movement-response.dto.js';
import { ListInventoryMovementsDto } from './dto/list-inventory-movements.dto.js';
import { InventoryService } from './inventory.service.js';

@Controller('inventory/movements')
@UseGuards(AccessTokenGuard, ServicePermissionGuard)
@RequireService('PRODUCTS')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Post()
  create(
    @Body() dto: CreateInventoryMovementDto,
    @CurrentUser() currentUser: CurrentUserContext,
  ): Promise<InventoryMovementResponse> {
    return this.inventory.createMovement(dto, currentUser);
  }

  @Get()
  list(
    @Query() query: ListInventoryMovementsDto,
  ): Promise<InventoryMovementListResponse> {
    return this.inventory.listMovements(query);
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<InventoryMovementResponse> {
    return this.inventory.getMovementById(id);
  }
}

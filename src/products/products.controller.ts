import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RequireService } from '../auth/service-permission.decorator.js';
import { ServicePermissionGuard } from '../auth/service-permission.guard.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import type {
  ProductListResponse,
  ProductResponse,
} from './dto/product-response.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { ProductsService } from './products.service.js';

@Controller('products')
@UseGuards(AccessTokenGuard, ServicePermissionGuard)
@RequireService('PRODUCTS')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(): Promise<ProductListResponse> {
    return this.products.listProducts();
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<ProductResponse> {
    return this.products.getProductById(id);
  }

  @Post()
  create(@Body() dto: CreateProductDto): Promise<ProductResponse> {
    return this.products.createProduct(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    return this.products.updateProduct(id, dto);
  }
}

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
import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import type {
  CategoryListResponse,
  CategoryResponse,
} from './dto/category-response.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

@Controller('categories')
@UseGuards(AccessTokenGuard, ServicePermissionGuard)
@RequireService('PRODUCTS')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(): Promise<CategoryListResponse> {
    return this.categories.listCategories();
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<CategoryResponse> {
    return this.categories.getCategoryById(id);
  }

  @Post()
  create(@Body() dto: CreateCategoryDto): Promise<CategoryResponse> {
    return this.categories.createCategory(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponse> {
    return this.categories.updateCategory(id, dto);
  }
}

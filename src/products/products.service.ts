import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CreateProductDto } from './dto/create-product.dto.js';
import type {
  ProductListResponse,
  ProductResponse,
} from './dto/product-response.dto.js';
import type { UpdateProductDto } from './dto/update-product.dto.js';

const PRODUCT_NOT_FOUND = 'Product not found.';
const CATEGORY_NOT_FOUND = 'Category not found.';
const CATEGORY_NOT_ACTIVE = 'Category is not active.';
const SKU_ALREADY_IN_USE = 'SKU is already in use.';

const PRODUCT_READ_SELECT = {
  id: true,
  categoryId: true,
  name: true,
  sku: true,
  description: true,
  sellingPrice: true,
  gstRate: true,
  stockQty: true,
  unit: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

type DecimalValue = {
  toString(): string;
};

type ProductReadRecord = {
  id: string;
  categoryId: string;
  name: string;
  sku: string | null;
  description: string | null;
  sellingPrice: DecimalValue;
  gstRate: DecimalValue;
  stockQty: DecimalValue;
  unit: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type ProductCreateData = {
  categoryId: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  sellingPrice: string;
  gstRate: string;
  unit?: string;
};

type ProductUpdateData = {
  categoryId?: string;
  name?: string;
  sku?: string | null;
  description?: string | null;
  sellingPrice?: string;
  gstRate?: string;
  unit?: string;
  isActive?: boolean;
};

function isProductSkuConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const modelName = error.meta?.modelName;
  if (modelName !== undefined && modelName !== 'Product') {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.includes('sku');
  }
  return target === 'sku';
}

function isProductCategoryReference(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2003'
  ) {
    return false;
  }
  const modelName = error.meta?.modelName;
  if (modelName !== undefined && modelName !== 'Product') {
    return false;
  }
  const fieldName = error.meta?.field_name;
  const constraint = error.meta?.constraint;
  const reference = [fieldName, constraint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return reference.includes('categoryId');
}

function isMissingProduct(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2025'
  ) {
    return false;
  }
  const modelName = error.meta?.modelName;
  return modelName === undefined || modelName === 'Product';
}

function toProductResponse(product: ProductReadRecord): ProductResponse {
  return {
    id: product.id,
    categoryId: product.categoryId,
    name: product.name,
    sku: product.sku,
    description: product.description,
    sellingPrice: product.sellingPrice.toString(),
    gstRate: product.gstRate.toString(),
    stockQty: product.stockQty.toString(),
    unit: product.unit,
    isActive: product.isActive,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async listProducts(): Promise<ProductListResponse> {
    const products = await this.prisma.product.findMany({
      select: PRODUCT_READ_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return { products: products.map((product) => toProductResponse(product)) };
  }

  async getProductById(id: string): Promise<ProductResponse> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: PRODUCT_READ_SELECT,
    });
    if (!product) {
      throw new NotFoundException(PRODUCT_NOT_FOUND);
    }
    return toProductResponse(product);
  }

  async createProduct(dto: CreateProductDto): Promise<ProductResponse> {
    await this.requireActiveCategory(dto.categoryId);
    try {
      const product = await this.prisma.product.create({
        data: this.createData(dto),
        select: PRODUCT_READ_SELECT,
      });
      return toProductResponse(product);
    } catch (error) {
      throw this.productWriteError(error);
    }
  }

  async updateProduct(
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    if (this.isEmptyPatch(dto)) {
      return this.getProductById(id);
    }
    if (dto.categoryId !== undefined) {
      await this.requireActiveCategory(dto.categoryId);
    }
    try {
      const product = await this.prisma.product.update({
        where: { id },
        data: this.updateData(dto),
        select: PRODUCT_READ_SELECT,
      });
      return toProductResponse(product);
    } catch (error) {
      throw this.productWriteError(error);
    }
  }

  private async requireActiveCategory(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, isActive: true },
    });
    if (!category) {
      throw new NotFoundException(CATEGORY_NOT_FOUND);
    }
    if (!category.isActive) {
      throw new ConflictException(CATEGORY_NOT_ACTIVE);
    }
  }

  private createData(dto: CreateProductDto): ProductCreateData {
    return {
      categoryId: dto.categoryId,
      name: dto.name,
      sellingPrice: dto.sellingPrice,
      gstRate: dto.gstRate,
      ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
    };
  }

  private updateData(dto: UpdateProductDto): ProductUpdateData {
    const data: ProductUpdateData = {};
    if (dto.categoryId !== undefined) {
      data.categoryId = dto.categoryId;
    }
    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.sku !== undefined) {
      data.sku = dto.sku;
    }
    if (dto.description !== undefined) {
      data.description = dto.description;
    }
    if (dto.sellingPrice !== undefined) {
      data.sellingPrice = dto.sellingPrice;
    }
    if (dto.gstRate !== undefined) {
      data.gstRate = dto.gstRate;
    }
    if (dto.unit !== undefined) {
      data.unit = dto.unit;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }
    return data;
  }

  private isEmptyPatch(dto: UpdateProductDto): boolean {
    return (
      dto.categoryId === undefined &&
      dto.name === undefined &&
      dto.sku === undefined &&
      dto.description === undefined &&
      dto.sellingPrice === undefined &&
      dto.gstRate === undefined &&
      dto.unit === undefined &&
      dto.isActive === undefined
    );
  }

  private productWriteError(error: unknown): Error {
    if (isProductSkuConflict(error)) {
      return new ConflictException(SKU_ALREADY_IN_USE);
    }
    if (isProductCategoryReference(error)) {
      return new NotFoundException(CATEGORY_NOT_FOUND);
    }
    if (isMissingProduct(error)) {
      return new NotFoundException(PRODUCT_NOT_FOUND);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

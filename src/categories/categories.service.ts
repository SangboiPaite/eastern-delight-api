import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CreateCategoryDto } from './dto/create-category.dto.js';
import type {
  CategoryListResponse,
  CategoryResponse,
} from './dto/category-response.dto.js';
import type { UpdateCategoryDto } from './dto/update-category.dto.js';

const CATEGORY_NOT_FOUND = 'Category not found.';
const CATEGORY_NAME_IN_USE = 'Category name is already in use.';

const CATEGORY_READ_SELECT = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

type CategoryReadRecord = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function isCategoryNameConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const modelName = error.meta?.modelName;
  if (modelName !== undefined && modelName !== 'Category') {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.includes('name');
  }
  return target === 'name';
}

function isMissingCategory(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2025'
  ) {
    return false;
  }
  const modelName = error.meta?.modelName;
  return modelName === undefined || modelName === 'Category';
}

function toCategoryResponse(category: CategoryReadRecord): CategoryResponse {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    isActive: category.isActive,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(): Promise<CategoryListResponse> {
    const categories = await this.prisma.category.findMany({
      select: CATEGORY_READ_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return {
      categories: categories.map((category) => toCategoryResponse(category)),
    };
  }

  async getCategoryById(id: string): Promise<CategoryResponse> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: CATEGORY_READ_SELECT,
    });
    if (!category) {
      throw new NotFoundException(CATEGORY_NOT_FOUND);
    }
    return toCategoryResponse(category);
  }

  async createCategory(dto: CreateCategoryDto): Promise<CategoryResponse> {
    try {
      const category = await this.prisma.category.create({
        data: {
          name: dto.name,
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
        },
        select: CATEGORY_READ_SELECT,
      });
      return toCategoryResponse(category);
    } catch (error) {
      if (isCategoryNameConflict(error)) {
        throw new ConflictException(CATEGORY_NAME_IN_USE);
      }
      throw error;
    }
  }

  async updateCategory(
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryResponse> {
    if (
      dto.name === undefined &&
      dto.description === undefined &&
      dto.isActive === undefined
    ) {
      return this.getCategoryById(id);
    }

    const data: {
      name?: string;
      description?: string | null;
      isActive?: boolean;
    } = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.description !== undefined) {
      data.description = dto.description;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    try {
      const category = await this.prisma.category.update({
        where: { id },
        data,
        select: CATEGORY_READ_SELECT,
      });
      return toCategoryResponse(category);
    } catch (error) {
      if (isCategoryNameConflict(error)) {
        throw new ConflictException(CATEGORY_NAME_IN_USE);
      }
      if (isMissingCategory(error)) {
        throw new NotFoundException(CATEGORY_NOT_FOUND);
      }
      throw error;
    }
  }
}

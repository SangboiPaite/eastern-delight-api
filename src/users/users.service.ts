import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { normalizeMobile } from '../auth/normalize-mobile.js';
import { PasswordService } from '../auth/password.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { ListUsersDto } from './dto/list-users.dto.js';
import type {
  UserListResponse,
  UserResponse,
} from './dto/user-response.dto.js';

const MOBILE_ALREADY_REGISTERED = 'Mobile number is already registered.';

const USER_READ_SELECT = {
  id: true,
  name: true,
  mobile: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  permissions: {
    select: { service: true },
    orderBy: { service: 'asc' as const },
  },
} as const;

type UserReadRecord = {
  id: string;
  name: string;
  mobile: string;
  role: UserResponse['role'];
  status: UserResponse['status'];
  createdAt: Date;
  updatedAt: Date;
  permissions: { service: UserResponse['permissions'][number] }[];
};

function isUserMobileConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const modelName = error.meta?.modelName;
  if (modelName !== undefined && modelName !== 'User') {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.includes('mobile');
  }
  return target === 'mobile';
}

function toUserResponse(user: UserReadRecord): UserResponse {
  return {
    id: user.id,
    name: user.name,
    mobile: user.mobile,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    permissions: user.permissions.map((permission) => permission.service),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async listUsers(query: ListUsersDto): Promise<UserListResponse> {
    const users = await this.prisma.user.findMany({
      where: {
        ...(query.role ? { role: query.role } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      select: USER_READ_SELECT,
      orderBy: { createdAt: 'asc' },
    });

    return { users: users.map((user) => toUserResponse(user)) };
  }

  async getUserById(id: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_READ_SELECT,
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return toUserResponse(user);
  }

  async createUser(dto: CreateUserDto): Promise<UserResponse> {
    const permissions = dto.permissions ?? [];
    const mobile = normalizeMobile(dto.mobile);
    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          name: dto.name,
          mobile,
          passwordHash,
          role: dto.role ?? 'STAFF',
          status: 'PENDING',
          ...(permissions.length > 0
            ? {
                permissions: {
                  create: permissions.map((service) => ({ service })),
                },
              }
            : {}),
        },
        select: USER_READ_SELECT,
      });
      return toUserResponse(user);
    } catch (error) {
      if (isUserMobileConflict(error)) {
        throw new ConflictException(MOBILE_ALREADY_REGISTERED);
      }
      throw error;
    }
  }
}

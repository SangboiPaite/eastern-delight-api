import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { CurrentUserContext } from '../auth/current-user.js';
import { normalizeMobile } from '../auth/normalize-mobile.js';
import { PasswordService } from '../auth/password.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { ListUsersDto } from './dto/list-users.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import type {
  UserListResponse,
  UserResponse,
} from './dto/user-response.dto.js';

const MOBILE_ALREADY_REGISTERED = 'Mobile number is already registered.';
const USER_NOT_FOUND = 'User not found.';
const CANNOT_APPROVE = 'User cannot be approved from the current status.';
const CANNOT_REJECT = 'User cannot be rejected from the current status.';
const CANNOT_DEACTIVATE =
  'User cannot be deactivated from the current status.';

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

function isMissingUser(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2025'
  ) {
    return false;
  }
  const modelName = error.meta?.modelName;
  return modelName === undefined || modelName === 'User';
}

type UserStatus = UserResponse['status'];

type StatusChangeData = {
  status: UserStatus;
  approvedAt?: Date | null;
  approvedById?: string | null;
};

type UserStatusDelegate = {
  updateMany(args: {
    where: { id: string; status: UserStatus };
    data: StatusChangeData;
  }): Promise<{ count: number }>;
  findUnique(args: {
    where: { id: string };
    select: typeof USER_READ_SELECT | { id: true };
  }): Promise<UserReadRecord | { id: string } | null>;
};

function assertActorIsNotTarget(targetId: string, actorId: string): void {
  if (targetId === actorId) {
    throw new ForbiddenException();
  }
}

async function changeUserStatus(
  user: UserStatusDelegate,
  id: string,
  expectedStatus: UserStatus,
  data: StatusChangeData,
  conflictMessage: string,
): Promise<UserReadRecord> {
  const updated = await user.updateMany({
    where: { id, status: expectedStatus },
    data,
  });
  if (updated.count !== 1) {
    const existing = await user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(USER_NOT_FOUND);
    }
    throw new ConflictException(conflictMessage);
  }

  const changed = await user.findUnique({
    where: { id },
    select: USER_READ_SELECT,
  });
  if (!changed || !('name' in changed)) {
    throw new NotFoundException(USER_NOT_FOUND);
  }
  return changed;
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
      throw new NotFoundException(USER_NOT_FOUND);
    }
    return toUserResponse(user);
  }

  async approveUser(
    id: string,
    currentUser: CurrentUserContext,
  ): Promise<UserResponse> {
    assertActorIsNotTarget(id, currentUser.id);
    const user = await changeUserStatus(
      this.prisma.user,
      id,
      'PENDING',
      {
        status: 'ACTIVE',
        approvedAt: new Date(),
        approvedById: currentUser.id,
      },
      CANNOT_APPROVE,
    );
    return toUserResponse(user);
  }

  async rejectUser(
    id: string,
    currentUser: CurrentUserContext,
  ): Promise<UserResponse> {
    assertActorIsNotTarget(id, currentUser.id);
    const revokedAt = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      const changed = await changeUserStatus(
        tx.user,
        id,
        'PENDING',
        {
          status: 'REJECTED',
          approvedAt: null,
          approvedById: null,
        },
        CANNOT_REJECT,
      );
      await tx.refreshSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt },
      });
      return changed;
    });
    return toUserResponse(user);
  }

  async deactivateUser(
    id: string,
    currentUser: CurrentUserContext,
  ): Promise<UserResponse> {
    assertActorIsNotTarget(id, currentUser.id);
    const revokedAt = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      const changed = await changeUserStatus(
        tx.user,
        id,
        'ACTIVE',
        { status: 'DEACTIVATED' },
        CANNOT_DEACTIVATE,
      );
      await tx.refreshSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt },
      });
      return changed;
    });
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

  async updateUser(
    id: string,
    dto: UpdateUserDto,
    currentUser: CurrentUserContext,
  ): Promise<UserResponse> {
    if (dto.role !== undefined && currentUser.id === id) {
      throw new ForbiddenException();
    }

    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: USER_READ_SELECT,
    });
    if (!existing) {
      throw new NotFoundException(USER_NOT_FOUND);
    }

    if (
      dto.name === undefined &&
      dto.mobile === undefined &&
      dto.role === undefined &&
      dto.password === undefined
    ) {
      return toUserResponse(existing);
    }

    const data: {
      name?: string;
      mobile?: string;
      role?: UserResponse['role'];
      passwordHash?: string;
    } = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.mobile !== undefined) {
      data.mobile = normalizeMobile(dto.mobile);
    }
    if (dto.role !== undefined) {
      data.role = dto.role;
    }
    if (dto.password !== undefined) {
      data.passwordHash = await this.passwords.hash(dto.password);
    }

    try {
      const user =
        dto.password === undefined
          ? await this.prisma.user.update({
              where: { id },
              data,
              select: USER_READ_SELECT,
            })
          : await this.prisma.$transaction(async (tx) => {
              const revokedAt = new Date();
              const updated = await tx.user.update({
                where: { id },
                data,
                select: USER_READ_SELECT,
              });
              await tx.refreshSession.updateMany({
                where: { userId: id, revokedAt: null },
                data: { revokedAt },
              });
              return updated;
            });
      return toUserResponse(user);
    } catch (error) {
      if (isUserMobileConflict(error)) {
        throw new ConflictException(MOBILE_ALREADY_REGISTERED);
      }
      if (isMissingUser(error)) {
        throw new NotFoundException(USER_NOT_FOUND);
      }
      throw error;
    }
  }
}

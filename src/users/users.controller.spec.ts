import {
  ArgumentMetadata,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { ROLES_KEY } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { TokenService } from '../auth/token.service.js';
import { ListUsersDto } from './dto/list-users.dto.js';
import type {
  UserListResponse,
  UserResponse,
} from './dto/user-response.dto.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const userResponse: UserResponse = {
  id: USER_ID,
  name: 'Ada',
  mobile: '9876543210',
  role: 'STAFF',
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  permissions: ['BILLING', 'PRODUCTS'],
};

describe('UsersController', () => {
  const users = {
    listUsers: vi.fn(),
    getUserById: vi.fn(),
  };

  async function controller(): Promise<UsersController> {
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: users },
        { provide: TokenService, useValue: { verifyAccessToken: vi.fn() } },
        Reflector,
      ],
    }).compile();
    return module.get(UsersController);
  }

  beforeEach(() => {
    users.listUsers.mockReset().mockResolvedValue({ users: [userResponse] });
    users.getUserById.mockReset().mockResolvedValue(userResponse);
  });

  it('delegates GET /users to UsersService with the list query', async () => {
    const query = { role: 'STAFF' as const, status: 'ACTIVE' as const };
    const expected: UserListResponse = { users: [userResponse] };
    users.listUsers.mockResolvedValue(expected);

    await expect((await controller()).list(query)).resolves.toEqual(expected);
    expect(users.listUsers).toHaveBeenCalledWith(query);
    expect(Reflect.getMetadata(PATH_METADATA, UsersController)).toBe('users');
    expect(Reflect.getMetadata(PATH_METADATA, UsersController.prototype.list)).toBe(
      '/',
    );
    expect(
      Reflect.getMetadata(METHOD_METADATA, UsersController.prototype.list),
    ).toBe(RequestMethod.GET);
  });

  it('delegates GET /users/:id to UsersService with the user id', async () => {
    await expect((await controller()).getById(USER_ID)).resolves.toEqual(
      userResponse,
    );
    expect(users.getUserById).toHaveBeenCalledWith(USER_ID);
    expect(
      Reflect.getMetadata(PATH_METADATA, UsersController.prototype.getById),
    ).toBe(':id');
    expect(
      Reflect.getMetadata(METHOD_METADATA, UsersController.prototype.getById),
    ).toBe(RequestMethod.GET);
  });

  it('requires the ADMIN role', () => {
    expect(Reflect.getMetadata(ROLES_KEY, UsersController)).toEqual(['ADMIN']);
  });

  it('uses AccessTokenGuard and RolesGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, UsersController)).toEqual([
      AccessTokenGuard,
      RolesGuard,
    ]);
  });
});

describe('ListUsersDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: ListUsersDto,
  };

  it('accepts role and status filters', async () => {
    const dto = (await pipe.transform(
      { role: 'ADMIN', status: 'PENDING' },
      metadata,
    )) as ListUsersDto;

    expect(dto.role).toBe('ADMIN');
    expect(dto.status).toBe('PENDING');
  });

  it('rejects an unknown role, status, or query field', async () => {
    await expect(
      pipe.transform({ role: 'admin' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ status: 'ARCHIVED' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ role: 'STAFF', extra: '1' }, metadata),
    ).rejects.toBeDefined();
  });
});

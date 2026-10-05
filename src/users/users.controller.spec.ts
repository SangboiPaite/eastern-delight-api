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
import { CreateUserDto } from './dto/create-user.dto.js';
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
    createUser: vi.fn(),
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
    users.createUser.mockReset().mockResolvedValue(userResponse);
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

  it('delegates POST /users to UsersService with the create DTO', async () => {
    const dto = {
      name: 'John',
      mobile: '9876543210',
      password: '  secret  ',
      role: 'ADMIN' as const,
      permissions: ['BILLING' as const, 'PRODUCTS' as const],
    };
    const created = { ...userResponse, status: 'PENDING' as const };
    users.createUser.mockResolvedValue(created);

    await expect((await controller()).create(dto)).resolves.toEqual(created);
    expect(users.createUser).toHaveBeenCalledWith(dto);
    expect(Reflect.getMetadata(PATH_METADATA, UsersController.prototype.create)).toBe(
      '/',
    );
    expect(
      Reflect.getMetadata(METHOD_METADATA, UsersController.prototype.create),
    ).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(ROLES_KEY, UsersController)).toEqual(['ADMIN']);
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

describe('CreateUserDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: CreateUserDto,
  };

  it('accepts a STAFF user and keeps the password unchanged', async () => {
    const dto = (await pipe.transform(
      {
        name: 'John',
        mobile: '9876543210',
        password: '  secret  ',
      },
      metadata,
    )) as CreateUserDto;

    expect(dto.name).toBe('John');
    expect(dto.mobile).toBe('9876543210');
    expect(dto.password).toBe('  secret  ');
    expect(dto.role).toBeUndefined();
    expect(dto.permissions).toBeUndefined();
  });

  it('accepts an ADMIN user with service permissions', async () => {
    const dto = (await pipe.transform(
      {
        name: 'John',
        mobile: '9876543210',
        password: 'secret',
        role: 'ADMIN',
        permissions: ['BILLING', 'PRODUCTS'],
      },
      metadata,
    )) as CreateUserDto;

    expect(dto.role).toBe('ADMIN');
    expect(dto.permissions).toEqual(['BILLING', 'PRODUCTS']);
  });

  it('rejects an invalid role or permission', async () => {
    await expect(
      pipe.transform(
        {
          name: 'John',
          mobile: '9876543210',
          password: 'secret',
          role: 'admin',
        },
        metadata,
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        {
          name: 'John',
          mobile: '9876543210',
          password: 'secret',
          permissions: ['BILLING', 'INVOICES'],
        },
        metadata,
      ),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        {
          name: 'John',
          mobile: '9876543210',
          password: 'secret',
          permissions: ['BILLING', 'BILLING'],
        },
        metadata,
      ),
    ).rejects.toBeDefined();
  });

  it('rejects unknown fields and protected user fields', async () => {
    const body = {
      name: 'John',
      mobile: '9876543210',
      password: 'secret',
    };

    await expect(
      pipe.transform({ ...body, extra: true }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...body, status: 'ACTIVE' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...body, approvedAt: '2026-01-01' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...body, approvedById: USER_ID }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ ...body, passwordHash: 'hash' }, metadata),
    ).rejects.toBeDefined();
  });

  it('rejects a missing name, mobile, or password', async () => {
    await expect(
      pipe.transform({ mobile: '9876543210', password: 'secret' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ name: 'John', password: 'secret' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform({ name: 'John', mobile: '9876543210' }, metadata),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        { name: '', mobile: '9876543210', password: 'secret' },
        metadata,
      ),
    ).rejects.toBeDefined();
  });
});

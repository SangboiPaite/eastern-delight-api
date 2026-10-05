import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PasswordService } from '../auth/password.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { UsersService } from './users.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');

function userRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    name: 'Ada',
    mobile: '9876543210',
    role: 'STAFF',
    status: 'ACTIVE',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    passwordHash: 'stored-hash',
    refreshSessions: [{ id: 'session-1', tokenHash: 'hash' }],
    permissions: [{ service: 'PRODUCTS' }, { service: 'BILLING' }],
    ...overrides,
  };
}

describe('UsersService', () => {
  const prisma = {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };
  const passwords = { hash: vi.fn() };
  const service = new UsersService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
  );

  beforeEach(() => {
    prisma.user.findMany.mockReset().mockResolvedValue([userRecord()]);
    prisma.user.findUnique.mockReset().mockResolvedValue(userRecord());
    prisma.user.create.mockReset().mockResolvedValue(
      userRecord({
        status: 'PENDING',
        passwordHash: 'hashed-password',
        permissions: [{ service: 'BILLING' }, { service: 'PRODUCTS' }],
      }),
    );
    passwords.hash.mockReset().mockResolvedValue('hashed-password');
  });

  function listQuery(): {
    where: { role?: string; status?: string };
    select: Record<string, unknown>;
    orderBy: unknown;
  } {
    return prisma.user.findMany.mock.calls[0]?.[0] as {
      where: { role?: string; status?: string };
      select: Record<string, unknown>;
      orderBy: unknown;
    };
  }

  function uniqueQuery(): {
    where: { id: string };
    select: Record<string, unknown>;
  } {
    return prisma.user.findUnique.mock.calls[0]?.[0] as {
      where: { id: string };
      select: Record<string, unknown>;
    };
  }

  function expectSafeSelect(select: Record<string, unknown>): void {
    expect(select).toEqual({
      id: true,
      name: true,
      mobile: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      permissions: {
        select: { service: true },
        orderBy: { service: 'asc' },
      },
    });
    expect(select).not.toHaveProperty('passwordHash');
    expect(select).not.toHaveProperty('refreshSessions');
  }

  it('lists users without authentication secrets', async () => {
    const result = await service.listUsers({});

    expectSafeSelect(listQuery().select);
    expect(listQuery().where).toEqual({});
    expect(listQuery().orderBy).toEqual({ createdAt: 'asc' });
    expect(result).toEqual({
      users: [
        {
          id: USER_ID,
          name: 'Ada',
          mobile: '9876543210',
          role: 'STAFF',
          status: 'ACTIVE',
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
          permissions: ['PRODUCTS', 'BILLING'],
        },
      ],
    });
    expect(result.users[0]).not.toHaveProperty('passwordHash');
    expect(result.users[0]).not.toHaveProperty('refreshSessions');
    expect(JSON.stringify(result)).not.toMatch(
      /passwordHash|refreshSessions|tokenHash/,
    );
  });

  it('filters the list by status', async () => {
    await service.listUsers({ status: 'PENDING' });

    expect(listQuery().where).toEqual({ status: 'PENDING' });
  });

  it('filters the list by role', async () => {
    await service.listUsers({ role: 'ADMIN' });

    expect(listQuery().where).toEqual({ role: 'ADMIN' });
  });

  it('includes service permissions on a single user', async () => {
    const result = await service.getUserById(USER_ID);

    expect(result.permissions).toEqual(['PRODUCTS', 'BILLING']);
    expect(uniqueQuery().select).toMatchObject({
      permissions: {
        select: { service: true },
      },
    });
  });

  it('does not select passwordHash when reading one user', async () => {
    const result = await service.getUserById(USER_ID);

    expectSafeSelect(uniqueQuery().select);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('gets one user by id', async () => {
    const result = await service.getUserById(USER_ID);

    expect(uniqueQuery().where).toEqual({ id: USER_ID });
    expect(result).toEqual({
      id: USER_ID,
      name: 'Ada',
      mobile: '9876543210',
      role: 'STAFF',
      status: 'ACTIVE',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      permissions: ['PRODUCTS', 'BILLING'],
    });
  });

  it('throws NotFoundException when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.getUserById(USER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getUserById(USER_ID)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('does not expose refresh sessions', async () => {
    const listed = await service.listUsers({});
    const fetched = await service.getUserById(USER_ID);

    expect(listQuery().select).not.toHaveProperty('refreshSessions');
    expect(uniqueQuery().select).not.toHaveProperty('refreshSessions');
    expect(listed.users[0]).not.toHaveProperty('refreshSessions');
    expect(fetched).not.toHaveProperty('refreshSessions');
  });

  describe('createUser', () => {
    function createCall(): {
      data: {
        name: string;
        mobile: string;
        passwordHash: string;
        role: string;
        status: string;
        permissions?: { create: { service: string }[] };
        approvedAt?: Date;
        approvedById?: string;
      };
      select: Record<string, unknown>;
    } {
      return prisma.user.create.mock.calls[0]?.[0] as {
        data: {
          name: string;
          mobile: string;
          passwordHash: string;
          role: string;
          status: string;
          permissions?: { create: { service: string }[] };
          approvedAt?: Date;
          approvedById?: string;
        };
        select: Record<string, unknown>;
      };
    }

    it('creates a PENDING STAFF user when role is omitted', async () => {
      const result = await service.createUser({
        name: 'John',
        mobile: '  9876543210  ',
        password: '  secret  ',
      });

      expect(passwords.hash).toHaveBeenCalledWith('  secret  ');
      expect(createCall().data).toEqual({
        name: 'John',
        mobile: '9876543210',
        passwordHash: 'hashed-password',
        role: 'STAFF',
        status: 'PENDING',
      });
      expect(createCall().data).not.toHaveProperty('approvedAt');
      expect(createCall().data).not.toHaveProperty('approvedById');
      expect(createCall().data).not.toHaveProperty('permissions');
      expectSafeSelect(createCall().select);
      expect(result).toEqual({
        id: USER_ID,
        name: 'Ada',
        mobile: '9876543210',
        role: 'STAFF',
        status: 'PENDING',
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        permissions: ['BILLING', 'PRODUCTS'],
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('refreshSessions');
      expect(JSON.stringify(result)).not.toMatch(
        /passwordHash|refreshSessions|tokenHash/,
      );
    });

    it('creates a specified ADMIN user as PENDING', async () => {
      await service.createUser({
        name: 'John',
        mobile: '9876543210',
        password: 'secret',
        role: 'ADMIN',
      });

      expect(createCall().data.role).toBe('ADMIN');
      expect(createCall().data.status).toBe('PENDING');
      expect(createCall().data).not.toHaveProperty('permissions');
    });

    it('stores the requested service permissions and no extras', async () => {
      await service.createUser({
        name: 'John',
        mobile: '9876543210',
        password: 'secret',
        permissions: ['BILLING', 'PRODUCTS'],
      });

      expect(createCall().data.permissions).toEqual({
        create: [{ service: 'BILLING' }, { service: 'PRODUCTS' }],
      });
      expect(createCall().data.status).toBe('PENDING');
      expect(createCall().data.role).toBe('STAFF');
    });

    it('converts a duplicate mobile constraint to ConflictException', async () => {
      const conflict = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`mobile`)',
        {
          code: 'P2002',
          clientVersion: '7.10.0',
          meta: { modelName: 'User', target: ['mobile'] },
        },
      );
      prisma.user.create.mockRejectedValue(conflict);

      await expect(
        service.createUser({
          name: 'John',
          mobile: '9876543210',
          password: 'secret',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.createUser({
          name: 'John',
          mobile: '9876543210',
          password: 'secret',
        }),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Mobile number is already registered.',
      });
    });

    it('propagates unrelated Prisma errors', async () => {
      const permissionConflict = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '7.10.0',
          meta: {
            modelName: 'UserServicePermission',
            target: ['userId', 'service'],
          },
        },
      );
      prisma.user.create.mockRejectedValue(permissionConflict);

      await expect(
        service.createUser({
          name: 'John',
          mobile: '9876543210',
          password: 'secret',
          permissions: ['BILLING'],
        }),
      ).rejects.toBe(permissionConflict);

      const unavailable = new Error('database unavailable');
      prisma.user.create.mockRejectedValue(unavailable);
      await expect(
        service.createUser({
          name: 'John',
          mobile: '9876543210',
          password: 'secret',
        }),
      ).rejects.toBe(unavailable);
    });
  });
});

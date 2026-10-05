import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { CurrentUserContext } from '../auth/current-user.js';
import { PasswordService } from '../auth/password.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { UsersService } from './users.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');

function admin(id = ADMIN_ID): CurrentUserContext {
  return {
    id,
    organizationId: '33333333-3333-4333-8333-333333333333',
    role: 'ADMIN',
  };
}

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
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    refreshSession: {
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    userServicePermission: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
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
    prisma.user.update.mockReset().mockResolvedValue(userRecord());
    prisma.user.updateMany.mockReset().mockResolvedValue({ count: 1 });
    prisma.refreshSession.updateMany.mockReset().mockResolvedValue({ count: 1 });
    prisma.refreshSession.delete.mockReset();
    prisma.refreshSession.deleteMany.mockReset();
    prisma.userServicePermission.deleteMany.mockReset().mockResolvedValue({
      count: 2,
    });
    prisma.userServicePermission.createMany.mockReset().mockResolvedValue({
      count: 1,
    });
    prisma.$transaction.mockReset().mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
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

  describe('user status changes', () => {
    function statusUpdate(): {
      where: { id: string; status: string };
      data: {
        status: string;
        approvedAt?: Date | null;
        approvedById?: string | null;
      };
    } {
      return prisma.user.updateMany.mock.calls[0]?.[0] as {
        where: { id: string; status: string };
        data: {
          status: string;
          approvedAt?: Date | null;
          approvedById?: string | null;
        };
      };
    }

    function sessionRevocation(): {
      where: { userId: string; revokedAt: null };
      data: { revokedAt: Date };
    } {
      return prisma.refreshSession.updateMany.mock.calls[0]?.[0] as {
        where: { userId: string; revokedAt: null };
        data: { revokedAt: Date };
      };
    }

    function safeUser(status: string) {
      return {
        id: USER_ID,
        name: 'Ada',
        mobile: '9876543210',
        role: 'STAFF',
        status,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        permissions: ['PRODUCTS', 'BILLING'],
      };
    }

    function expectNoSessionDeletion(): void {
      expect(prisma.refreshSession.delete).not.toHaveBeenCalled();
      expect(prisma.refreshSession.deleteMany).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    }

    describe('approveUser', () => {
      it('approves a PENDING user and records the authenticated admin', async () => {
        prisma.user.findUnique.mockResolvedValue(
          userRecord({ status: 'ACTIVE' }),
        );

        const result = await service.approveUser(USER_ID, admin());

        expect(statusUpdate().where).toEqual({
          id: USER_ID,
          status: 'PENDING',
        });
        expect(statusUpdate().data).toEqual({
          status: 'ACTIVE',
          approvedAt: expect.any(Date),
          approvedById: ADMIN_ID,
        });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
        expect(result).toEqual(safeUser('ACTIVE'));
        expect(result).not.toHaveProperty('passwordHash');
        expect(result).not.toHaveProperty('refreshSessions');
        expect(JSON.stringify(result)).not.toMatch(
          /passwordHash|refreshSessions|tokenHash/,
        );
        expectNoSessionDeletion();
      });

      it('returns 404 when the user does not exist', async () => {
        prisma.user.updateMany.mockResolvedValue({ count: 0 });
        prisma.user.findUnique.mockResolvedValue(null);

        await expect(service.approveUser(USER_ID, admin())).rejects.toMatchObject(
          { status: 404, message: 'User not found.' },
        );
        await expect(
          service.approveUser(USER_ID, admin()),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
      });

      it.each(['ACTIVE', 'REJECTED', 'DEACTIVATED'])(
        'returns 409 when the user is %s',
        async (status) => {
          prisma.user.updateMany.mockResolvedValue({ count: 0 });
          prisma.user.findUnique.mockResolvedValue(userRecord({ status }));

          await expect(
            service.approveUser(USER_ID, admin()),
          ).rejects.toBeInstanceOf(ConflictException);
          await expect(
            service.approveUser(USER_ID, admin()),
          ).rejects.toMatchObject({
            status: 409,
            message: 'User cannot be approved from the current status.',
          });
          expect(prisma.user.updateMany).toHaveBeenCalledTimes(2);
          expect(prisma.user.update).not.toHaveBeenCalled();
        },
      );

      it('returns 403 when an admin approves their own user', async () => {
        await expect(
          service.approveUser(ADMIN_ID, admin()),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(service.approveUser(ADMIN_ID, admin())).rejects.toMatchObject(
          { status: 403 },
        );
        expect(prisma.user.updateMany).not.toHaveBeenCalled();
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
      });
    });

    describe('rejectUser', () => {
      it('rejects a PENDING user, clears approval, and revokes refresh sessions', async () => {
        prisma.user.findUnique.mockResolvedValue(
          userRecord({ status: 'REJECTED' }),
        );

        const result = await service.rejectUser(USER_ID, admin());

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(statusUpdate().where).toEqual({
          id: USER_ID,
          status: 'PENDING',
        });
        expect(statusUpdate().data).toEqual({
          status: 'REJECTED',
          approvedAt: null,
          approvedById: null,
        });
        expect(sessionRevocation()).toEqual({
          where: { userId: USER_ID, revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        });
        expect(result).toEqual(safeUser('REJECTED'));
        expect(result).not.toHaveProperty('passwordHash');
        expect(result).not.toHaveProperty('refreshSessions');
        expectNoSessionDeletion();
      });

      it('returns 404 when the user does not exist', async () => {
        prisma.user.updateMany.mockResolvedValue({ count: 0 });
        prisma.user.findUnique.mockResolvedValue(null);

        await expect(service.rejectUser(USER_ID, admin())).rejects.toMatchObject(
          { status: 404, message: 'User not found.' },
        );
        expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
        expectNoSessionDeletion();
      });

      it.each(['ACTIVE', 'REJECTED', 'DEACTIVATED'])(
        'returns 409 when the user is %s',
        async (status) => {
          prisma.user.updateMany.mockResolvedValue({ count: 0 });
          prisma.user.findUnique.mockResolvedValue(userRecord({ status }));

          await expect(service.rejectUser(USER_ID, admin())).rejects.toMatchObject(
            {
              status: 409,
              message: 'User cannot be rejected from the current status.',
            },
          );
          expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
          expect(prisma.user.update).not.toHaveBeenCalled();
        },
      );

      it('returns 403 when an admin rejects their own user', async () => {
        await expect(service.rejectUser(ADMIN_ID, admin())).rejects.toMatchObject(
          { status: 403 },
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('deactivateUser', () => {
      it('deactivates an ACTIVE user, keeps approval, and revokes refresh sessions', async () => {
        prisma.user.findUnique.mockResolvedValue(
          userRecord({ status: 'DEACTIVATED' }),
        );

        const result = await service.deactivateUser(USER_ID, admin());

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(statusUpdate().where).toEqual({
          id: USER_ID,
          status: 'ACTIVE',
        });
        expect(statusUpdate().data).toEqual({ status: 'DEACTIVATED' });
        expect(statusUpdate().data).not.toHaveProperty('approvedAt');
        expect(statusUpdate().data).not.toHaveProperty('approvedById');
        expect(sessionRevocation().where).toEqual({
          userId: USER_ID,
          revokedAt: null,
        });
        expect(result).toEqual(safeUser('DEACTIVATED'));
        expect(result).not.toHaveProperty('passwordHash');
        expect(result).not.toHaveProperty('refreshSessions');
        expectNoSessionDeletion();
      });

      it('returns 404 when the user does not exist', async () => {
        prisma.user.updateMany.mockResolvedValue({ count: 0 });
        prisma.user.findUnique.mockResolvedValue(null);

        await expect(
          service.deactivateUser(USER_ID, admin()),
        ).rejects.toMatchObject({
          status: 404,
          message: 'User not found.',
        });
        expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
      });

      it.each(['PENDING', 'REJECTED', 'DEACTIVATED'])(
        'returns 409 when the user is %s',
        async (status) => {
          prisma.user.updateMany.mockResolvedValue({ count: 0 });
          prisma.user.findUnique.mockResolvedValue(userRecord({ status }));

          await expect(
            service.deactivateUser(USER_ID, admin()),
          ).rejects.toMatchObject({
            status: 409,
            message: 'User cannot be deactivated from the current status.',
          });
          expect(statusUpdate().where.status).toBe('ACTIVE');
          expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
          expect(prisma.user.update).not.toHaveBeenCalled();
        },
      );

      it('returns 403 when an admin deactivates their own user', async () => {
        await expect(
          service.deactivateUser(ADMIN_ID, admin()),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });

    it('does not apply a status change after a concurrent transition', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      prisma.user.findUnique.mockResolvedValue(userRecord({ status: 'ACTIVE' }));

      await expect(service.approveUser(USER_ID, admin())).rejects.toMatchObject({
        status: 409,
      });
      await expect(service.rejectUser(USER_ID, admin())).rejects.toMatchObject({
        status: 409,
      });
      prisma.user.findUnique.mockResolvedValue(
        userRecord({ status: 'DEACTIVATED' }),
      );
      await expect(
        service.deactivateUser(USER_ID, admin()),
      ).rejects.toMatchObject({ status: 409 });

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany.mock.calls.map((call) => call[0].where)).toEqual(
        [
          { id: USER_ID, status: 'PENDING' },
          { id: USER_ID, status: 'PENDING' },
          { id: USER_ID, status: 'ACTIVE' },
        ],
      );
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
      expectNoSessionDeletion();
    });

    it('propagates unrelated database errors', async () => {
      const failure = new Error('database unavailable');
      prisma.user.updateMany.mockRejectedValue(failure);

      await expect(service.approveUser(USER_ID, admin())).rejects.toBe(failure);
      await expect(service.rejectUser(USER_ID, admin())).rejects.toBe(failure);
      await expect(service.deactivateUser(USER_ID, admin())).rejects.toBe(
        failure,
      );
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('updateUser', () => {
    function profileUpdate(): {
      where: { id: string };
      data: {
        name?: string;
        mobile?: string;
        role?: string;
        password?: string;
        passwordHash?: string;
        status?: string;
        approvedAt?: Date | null;
        approvedById?: string | null;
        permissions?: unknown;
      };
      select: Record<string, unknown>;
    } {
      return prisma.user.update.mock.calls[0]?.[0] as {
        where: { id: string };
        data: {
          name?: string;
          mobile?: string;
          role?: string;
          password?: string;
          passwordHash?: string;
          status?: string;
          approvedAt?: Date | null;
          approvedById?: string | null;
          permissions?: unknown;
        };
        select: Record<string, unknown>;
      };
    }

    function expectProfileOnly(data: Record<string, unknown>): void {
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('approvedAt');
      expect(data).not.toHaveProperty('approvedById');
      expect(data).not.toHaveProperty('permissions');
      expect(data).not.toHaveProperty('password');
    }

    function expectSafeResult(
      result: Awaited<ReturnType<UsersService['updateUser']>>,
    ): void {
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('refreshSessions');
      expect(JSON.stringify(result)).not.toMatch(
        /passwordHash|refreshSessions|tokenHash/,
      );
    }

    it('updates the name without touching sessions or protected fields', async () => {
      prisma.user.update.mockResolvedValue(userRecord({ name: 'Ada Lovelace' }));

      const result = await service.updateUser(
        USER_ID,
        { name: '  Ada Lovelace  ' },
        admin(),
      );

      expect(profileUpdate()).toEqual({
        where: { id: USER_ID },
        data: { name: '  Ada Lovelace  ' },
        select: expect.any(Object),
      });
      expectProfileOnly(profileUpdate().data);
      expectSafeSelect(profileUpdate().select);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
      expect(result.name).toBe('Ada Lovelace');
      expect(result.status).toBe('ACTIVE');
      expectSafeResult(result);
    });

    it('normalizes and updates the mobile number', async () => {
      prisma.user.update.mockResolvedValue(userRecord({ mobile: '9876543210' }));

      const result = await service.updateUser(
        USER_ID,
        { mobile: '  9876543210  ' },
        admin(),
      );

      expect(profileUpdate().data).toEqual({ mobile: '9876543210' });
      expectProfileOnly(profileUpdate().data);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
      expect(result.mobile).toBe('9876543210');
      expectSafeResult(result);
    });

    it('updates another user role without changing status or approval', async () => {
      prisma.user.update.mockResolvedValue(userRecord({ role: 'ADMIN' }));

      const result = await service.updateUser(
        USER_ID,
        { role: 'ADMIN' },
        admin(),
      );

      expect(profileUpdate().data).toEqual({ role: 'ADMIN' });
      expectProfileOnly(profileUpdate().data);
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
      expect(result.role).toBe('ADMIN');
      expect(result.status).toBe('ACTIVE');
      expectSafeResult(result);
    });

    it('hashes a password and revokes active refresh sessions in one transaction', async () => {
      const order: string[] = [];
      prisma.user.update.mockImplementation(async () => {
        order.push('user.update');
        return userRecord();
      });
      prisma.refreshSession.updateMany.mockImplementation(async () => {
        order.push('refresh.revoke');
        return { count: 2 };
      });

      const result = await service.updateUser(
        USER_ID,
        { password: '  secret  ' },
        admin(),
      );

      expect(passwords.hash).toHaveBeenCalledWith('  secret  ');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['user.update', 'refresh.revoke']);
      expect(profileUpdate().data).toEqual({ passwordHash: 'hashed-password' });
      expect(profileUpdate().data).not.toHaveProperty('password');
      expectProfileOnly(profileUpdate().data);
      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.refreshSession.delete).not.toHaveBeenCalled();
      expect(prisma.refreshSession.deleteMany).not.toHaveBeenCalled();
      expectSafeResult(result);
    });

    it('does not touch refresh sessions for a name, mobile, and role update', async () => {
      await service.updateUser(
        USER_ID,
        { name: 'Ada', mobile: '9876543210', role: 'ADMIN' },
        admin(),
      );

      expect(profileUpdate().data).toEqual({
        name: 'Ada',
        mobile: '9876543210',
        role: 'ADMIN',
      });
      expectProfileOnly(profileUpdate().data);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
      expect(passwords.hash).not.toHaveBeenCalled();
    });

    it.each(['PENDING', 'ACTIVE', 'REJECTED', 'DEACTIVATED'] as const)(
      'leaves a %s user in that status',
      async (status) => {
        prisma.user.findUnique.mockResolvedValue(userRecord({ status }));
        prisma.user.update.mockResolvedValue(userRecord({ status }));

        const result = await service.updateUser(
          USER_ID,
          { name: 'Ada' },
          admin(),
        );

        expect(profileUpdate().data).toEqual({ name: 'Ada' });
        expect(result.status).toBe(status);
      },
    );

    it('lets an admin edit their own name', async () => {
      await service.updateUser(USER_ID, { name: 'Ada' }, admin(USER_ID));

      expect(profileUpdate().data).toEqual({ name: 'Ada' });
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('lets an admin edit their own mobile', async () => {
      await service.updateUser(
        USER_ID,
        { mobile: '  9000000000  ' },
        admin(USER_ID),
      );

      expect(profileUpdate().data).toEqual({ mobile: '9000000000' });
    });

    it('lets an admin edit their own password and revokes their sessions', async () => {
      await service.updateUser(
        USER_ID,
        { password: 'next-secret' },
        admin(USER_ID),
      );

      expect(passwords.hash).toHaveBeenCalledWith('next-secret');
      expect(profileUpdate().data).toEqual({ passwordHash: 'hashed-password' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('returns 403 before mutation when an admin changes their own role', async () => {
      await expect(
        service.updateUser(
          USER_ID,
          { role: 'STAFF', name: 'Ada' },
          admin(USER_ID),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.updateUser(USER_ID, { role: 'ADMIN' }, admin(USER_ID)),
      ).rejects.toMatchObject({ status: 403 });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
    });

    it('returns 404 when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateUser(USER_ID, { name: 'Ada' }, admin()),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.updateUser(USER_ID, { name: 'Ada' }, admin()),
      ).rejects.toMatchObject({
        status: 404,
        message: 'User not found.',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
    });

    it('returns 404 when the user disappears during the update', async () => {
      const missing = new Prisma.PrismaClientKnownRequestError(
        'Record to update not found.',
        {
          code: 'P2025',
          clientVersion: '7.10.0',
          meta: { modelName: 'User' },
        },
      );
      prisma.user.update.mockRejectedValue(missing);

      await expect(
        service.updateUser(USER_ID, { name: 'Ada' }, admin()),
      ).rejects.toMatchObject({
        status: 404,
        message: 'User not found.',
      });
    });

    it('accepts the user current mobile without a duplicate conflict', async () => {
      const result = await service.updateUser(
        USER_ID,
        { mobile: '9876543210' },
        admin(),
      );

      expect(profileUpdate().data).toEqual({ mobile: '9876543210' });
      expect(result.mobile).toBe('9876543210');
    });

    it('returns 409 when the mobile belongs to another user', async () => {
      const conflict = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`mobile`)',
        {
          code: 'P2002',
          clientVersion: '7.10.0',
          meta: { modelName: 'User', target: ['mobile'] },
        },
      );
      prisma.user.update.mockRejectedValue(conflict);

      await expect(
        service.updateUser(USER_ID, { mobile: '9000000000' }, admin()),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.updateUser(USER_ID, { mobile: '9000000000' }, admin()),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Mobile number is already registered.',
      });
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
    });

    it('propagates unrelated database errors', async () => {
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
      prisma.user.update.mockRejectedValue(permissionConflict);

      await expect(
        service.updateUser(USER_ID, { name: 'Ada' }, admin()),
      ).rejects.toBe(permissionConflict);

      const unavailable = new Error('database unavailable');
      prisma.user.update.mockRejectedValue(unavailable);
      await expect(
        service.updateUser(USER_ID, { password: 'secret' }, admin()),
      ).rejects.toBe(unavailable);
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
    });

    it('returns the current user for an empty patch without a mutation', async () => {
      const result = await service.updateUser(USER_ID, {}, admin());

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
      expectSafeResult(result);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
      expect(passwords.hash).not.toHaveBeenCalled();
    });
  });

  describe('replaceUserPermissions', () => {
    function permissionDelete(): { where: { userId: string } } {
      return prisma.userServicePermission.deleteMany.mock.calls[0]?.[0] as {
        where: { userId: string };
      };
    }

    function permissionCreate(): {
      data: { userId: string; service: string }[];
    } {
      return prisma.userServicePermission.createMany.mock.calls[0]?.[0] as {
        data: { userId: string; service: string }[];
      };
    }

    function expectAccountUntouched(): void {
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
      expect(prisma.refreshSession.delete).not.toHaveBeenCalled();
      expect(prisma.refreshSession.deleteMany).not.toHaveBeenCalled();
    }

    it('replaces the permission set and returns the safe user', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: USER_ID })
        .mockResolvedValueOnce(
          userRecord({
            role: 'STAFF',
            status: 'ACTIVE',
            permissions: [{ service: 'CUSTOMERS' }, { service: 'REPORTS' }],
          }),
        );

      const result = await service.replaceUserPermissions(USER_ID, {
        permissions: ['REPORTS', 'CUSTOMERS'],
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(permissionDelete()).toEqual({ where: { userId: USER_ID } });
      expect(permissionCreate()).toEqual({
        data: [
          { userId: USER_ID, service: 'REPORTS' },
          { userId: USER_ID, service: 'CUSTOMERS' },
        ],
      });
      expect(
        permissionCreate().data.map((row) => Object.keys(row).sort()),
      ).toEqual([
        ['service', 'userId'],
        ['service', 'userId'],
      ]);
      expect(result).toEqual({
        id: USER_ID,
        name: 'Ada',
        mobile: '9876543210',
        role: 'STAFF',
        status: 'ACTIVE',
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        permissions: ['CUSTOMERS', 'REPORTS'],
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('refreshSessions');
      expect(JSON.stringify(result)).not.toMatch(
        /passwordHash|refreshSessions|tokenHash/,
      );
      expectAccountUntouched();
    });

    it('clears every permission when the submitted array is empty', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: USER_ID })
        .mockResolvedValueOnce(userRecord({ permissions: [] }));

      const result = await service.replaceUserPermissions(USER_ID, {
        permissions: [],
      });

      expect(permissionDelete()).toEqual({ where: { userId: USER_ID } });
      expect(prisma.userServicePermission.createMany).not.toHaveBeenCalled();
      expect(result.permissions).toEqual([]);
      expect(result.role).toBe('STAFF');
      expect(result.status).toBe('ACTIVE');
      expectAccountUntouched();
    });

    it('returns 404 when the user does not exist and writes no permissions', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.replaceUserPermissions(USER_ID, {
          permissions: ['BILLING'],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.replaceUserPermissions(USER_ID, {
          permissions: ['BILLING'],
        }),
      ).rejects.toMatchObject({
        status: 404,
        message: 'User not found.',
      });
      expect(prisma.userServicePermission.deleteMany).not.toHaveBeenCalled();
      expect(prisma.userServicePermission.createMany).not.toHaveBeenCalled();
      expectAccountUntouched();
    });

    it('propagates a write failure from inside the transaction', async () => {
      const failure = new Error('database unavailable');
      prisma.userServicePermission.createMany.mockRejectedValue(failure);

      await expect(
        service.replaceUserPermissions(USER_ID, {
          permissions: ['BILLING', 'PRODUCTS'],
        }),
      ).rejects.toBe(failure);
      expect(prisma.userServicePermission.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expectAccountUntouched();
    });

    it('does not create permissions when deleting the previous set fails', async () => {
      const failure = new Error('delete failed');
      prisma.userServicePermission.deleteMany.mockRejectedValue(failure);

      await expect(
        service.replaceUserPermissions(USER_ID, {
          permissions: ['BILLING'],
        }),
      ).rejects.toBe(failure);
      expect(prisma.userServicePermission.createMany).not.toHaveBeenCalled();
      expectAccountUntouched();
    });
  });
});

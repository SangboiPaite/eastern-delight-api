import {
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import { AuthService } from './auth.service.js';
import { INVALID_CREDENTIALS } from './auth.types.js';
import type { CurrentUserContext } from './current-user.js';
import type { LoginDto } from './dto/login.dto.js';
import { PasswordService } from './password.service.js';
import { hashRefreshToken } from './refresh-token.js';
import { TokenService } from './token.service.js';

const ORGANIZATION_SLUG = 'eastern-delight';
const BUSINESS_PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const PRESENTED_REFRESH_TOKEN = 'presented-refresh-token';

function loginDto(overrides: Partial<LoginDto> = {}): LoginDto {
  return {
    mobile: '9876543210',
    password: 'correct-horse',
    organizationSlug: ORGANIZATION_SLUG,
    ...overrides,
  };
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    name: 'Ada',
    role: 'ADMIN',
    status: 'ACTIVE',
    passwordHash: 'stored-hash',
    ...overrides,
  };
}

function activeRefreshSession(
  role: 'ADMIN' | 'STAFF' = 'ADMIN',
  status = 'ACTIVE',
  name = 'Ada',
) {
  return {
    id: SESSION_ID,
    revokedAt: null as Date | null,
    expiresAt: new Date(Date.now() + 86_400_000),
    user: {
      id: USER_ID,
      name,
      role,
      status,
    },
  };
}

function currentUser(
  role: CurrentUserContext['role'] = 'ADMIN',
  organizationId = BUSINESS_PROFILE_ID,
): CurrentUserContext {
  return {
    id: USER_ID,
    organizationId,
    role,
  };
}

function expectInvalidCredentials(error: unknown): void {
  expect(error).toBeInstanceOf(UnauthorizedException);
  const exception = error as UnauthorizedException;
  expect(exception.getStatus()).toBe(401);
  const body = exception.getResponse();
  const message =
    typeof body === 'string' ? body : (body as { message: string }).message;
  expect(message).toBe(INVALID_CREDENTIALS);
}

describe('AuthService', () => {
  const prisma = {
    businessProfile: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    refreshSession: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  const passwords = { verify: vi.fn() };
  const tokens = { signAccessToken: vi.fn() };
  const config = {
    getOrThrow: vi.fn((key: string) => {
      if (key === 'organizationSlug') {
        return ORGANIZATION_SLUG;
      }
      if (key === 'refreshTokenExpiresIn') {
        return '7d';
      }
      if (key === 'jwtAccessExpiresIn') {
        return '15m';
      }
      throw new Error(`unexpected config key ${key}`);
    }),
  };

  const service = new AuthService(
    prisma as never,
    passwords as unknown as PasswordService,
    tokens as unknown as TokenService,
    config as unknown as ConfigService<AppConfiguration, true>,
  );

  beforeEach(() => {
    prisma.businessProfile.findMany.mockReset().mockResolvedValue([
      { id: BUSINESS_PROFILE_ID },
    ]);
    prisma.user.findUnique.mockReset().mockResolvedValue(userRow());
    prisma.refreshSession.findUnique.mockReset();
    prisma.refreshSession.create.mockReset().mockResolvedValue({ id: 'session-1' });
    prisma.refreshSession.update.mockReset().mockResolvedValue({ id: SESSION_ID });
    prisma.refreshSession.updateMany.mockReset().mockResolvedValue({ count: 1 });
    prisma.$transaction.mockReset().mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    passwords.verify.mockReset().mockResolvedValue(true);
    tokens.signAccessToken.mockReset().mockResolvedValue('signed.access.token');
    config.getOrThrow.mockClear();
  });

  it('authenticates an active admin and persists only the refresh-token hash', async () => {
    const result = await service.login(loginDto());

    expect(tokens.signAccessToken).toHaveBeenCalledWith({
      sub: USER_ID,
      org: BUSINESS_PROFILE_ID,
      role: 'ADMIN',
    });
    expect(result.tokenType).toBe('Bearer');
    expect(result.expiresIn).toBe('15m');
    expect(result.accessToken).toBe('signed.access.token');
    expect(result.user).toEqual({
      id: USER_ID,
      organizationId: BUSINESS_PROFILE_ID,
      role: 'admin',
      name: 'Ada',
    });
    expect(result).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(result)).not.toMatch(/passwordHash|permissions/i);
    expect(result.refreshToken.length).toBeGreaterThan(16);

    const created = prisma.refreshSession.create.mock.calls[0]?.[0] as {
      data: { userId: string; tokenHash: string; expiresAt: Date };
    };
    expect(created.data.userId).toBe(USER_ID);
    expect(created.data.tokenHash).toBe(hashRefreshToken(result.refreshToken));
    expect(created.data.tokenHash).not.toBe(result.refreshToken);
    expect(created.data).not.toHaveProperty('revokedAt');
    expect(created.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('maps an active staff user to the frontend staff role', async () => {
    prisma.user.findUnique.mockResolvedValue(
      userRow({ role: 'STAFF', name: 'Priya' }),
    );

    const result = await service.login(loginDto());

    expect(tokens.signAccessToken).toHaveBeenCalledWith({
      sub: USER_ID,
      org: BUSINESS_PROFILE_ID,
      role: 'STAFF',
    });
    expect(result.user.role).toBe('staff');
    expect(result.user.name).toBe('Priya');
  });

  it('looks up the trimmed mobile without altering stored digits', async () => {
    await service.login(loginDto({ mobile: '  9876543210  ' }));

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { mobile: '9876543210' },
      select: {
        id: true,
        name: true,
        role: true,
        status: true,
        passwordHash: true,
      },
    });
  });

  it('passes the password through without trimming', async () => {
    await service.login(loginDto({ password: '  secret  ' }));
    expect(passwords.verify).toHaveBeenCalledWith('stored-hash', '  secret  ');
  });

  const invalidCredentialCases: Array<[string, () => void, LoginDto?]> = [
    [
      'unknown mobile',
      () => {
        prisma.user.findUnique.mockResolvedValue(null);
      },
    ],
    [
      'incorrect password',
      () => {
        passwords.verify.mockResolvedValue(false);
      },
    ],
    [
      'wrong organization slug',
      () => {},
      loginDto({ organizationSlug: 'other-store' }),
    ],
    [
      'PENDING user',
      () => {
        prisma.user.findUnique.mockResolvedValue(userRow({ status: 'PENDING' }));
      },
    ],
    [
      'REJECTED user',
      () => {
        prisma.user.findUnique.mockResolvedValue(userRow({ status: 'REJECTED' }));
      },
    ],
    [
      'DEACTIVATED user',
      () => {
        prisma.user.findUnique.mockResolvedValue(
          userRow({ status: 'DEACTIVATED' }),
        );
      },
    ],
  ];

  it.each(invalidCredentialCases)(
    'returns Invalid credentials for %s',
    async (_name, arrange, dto) => {
      arrange();
      try {
        await service.login(dto ?? loginDto());
        throw new Error('expected login to fail');
      } catch (error) {
        expectInvalidCredentials(error);
      }
    },
  );

  it('treats a missing BusinessProfile as a server configuration error', async () => {
    prisma.businessProfile.findMany.mockResolvedValue([]);

    await expect(service.login(loginDto())).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  describe('refresh', () => {
    const presented = PRESENTED_REFRESH_TOKEN;

    beforeEach(() => {
      prisma.refreshSession.findUnique.mockResolvedValue(activeRefreshSession());
    });

    async function refreshAs(
      role: 'ADMIN' | 'STAFF',
      name: string,
    ) {
      let insideTransaction = false;
      prisma.refreshSession.findUnique.mockResolvedValue(
        activeRefreshSession(role, 'ACTIVE', name),
      );
      prisma.$transaction.mockImplementation(
        async (fn: (tx: typeof prisma) => Promise<unknown>) => {
          insideTransaction = true;
          try {
            return await fn(prisma);
          } finally {
            insideTransaction = false;
          }
        },
      );
      prisma.refreshSession.updateMany.mockImplementation(async () => {
        expect(insideTransaction).toBe(true);
        return { count: 1 };
      });
      prisma.refreshSession.create.mockImplementation(async () => {
        expect(insideTransaction).toBe(true);
        return { id: 'new-session' };
      });

      return service.refresh({ refreshToken: presented });
    }

    function persistedRefreshWrites(): unknown {
      return {
        updateMany: prisma.refreshSession.updateMany.mock.calls,
        create: prisma.refreshSession.create.mock.calls,
      };
    }

    it('rotates an active admin session and returns only the new refresh token', async () => {
      const result = await refreshAs('ADMIN', 'Ada');

      expect(tokens.signAccessToken).toHaveBeenCalledTimes(1);
      expect(tokens.signAccessToken).toHaveBeenCalledWith({
        sub: USER_ID,
        org: BUSINESS_PROFILE_ID,
        role: 'ADMIN',
      });
      const claims = tokens.signAccessToken.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(Object.keys(claims).sort()).toEqual(['org', 'role', 'sub']);
      expect(claims).not.toHaveProperty('refreshToken');
      expect(claims).not.toHaveProperty('passwordHash');
      expect(claims).not.toHaveProperty('name');
      expect(claims).not.toHaveProperty('mobile');
      expect(claims).not.toHaveProperty('permissions');
      expect(JSON.stringify(claims)).not.toContain(result.refreshToken);

      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBe('15m');
      expect(result.accessToken).toBe('signed.access.token');
      expect(result.user).toEqual({
        id: USER_ID,
        organizationId: BUSINESS_PROFILE_ID,
        role: 'admin',
        name: 'Ada',
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(result)).not.toMatch(/passwordHash/i);
      expect(result.refreshToken).not.toBe(presented);
      expect(result.refreshToken.length).toBeGreaterThan(16);

      expect(prisma.refreshSession.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: hashRefreshToken(presented) },
        select: {
          id: true,
          revokedAt: true,
          expiresAt: true,
          user: {
            select: {
              id: true,
              name: true,
              role: true,
              status: true,
            },
          },
        },
      });
      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { id: SESSION_ID, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });

      const created = prisma.refreshSession.create.mock.calls[0]?.[0] as {
        data: { userId: string; tokenHash: string; expiresAt: Date };
      };
      expect(created.data).toEqual({
        userId: USER_ID,
        tokenHash: hashRefreshToken(result.refreshToken),
        expiresAt: expect.any(Date),
      });
      expect(created.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(created.data.tokenHash).not.toBe(hashRefreshToken(presented));
      expect(created.data.tokenHash).not.toBe(result.refreshToken);
      expect(created.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(Object.values(created.data)).not.toContain(result.refreshToken);
      expect(Object.values(created.data)).not.toContain(presented);

      const writes = JSON.stringify(persistedRefreshWrites());
      expect(writes).toContain(hashRefreshToken(result.refreshToken));
      expect(writes).not.toContain(presented);
      expect(writes).not.toContain(result.refreshToken);
      expect(writes).not.toContain(hashRefreshToken(presented));
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('rotates an active staff session and maps the frontend staff role', async () => {
      const result = await refreshAs('STAFF', 'Priya');

      expect(tokens.signAccessToken).toHaveBeenCalledWith({
        sub: USER_ID,
        org: BUSINESS_PROFILE_ID,
        role: 'STAFF',
      });
      const claims = tokens.signAccessToken.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(Object.keys(claims).sort()).toEqual(['org', 'role', 'sub']);
      expect(claims).not.toHaveProperty('refreshToken');
      expect(result.user).toEqual({
        id: USER_ID,
        organizationId: BUSINESS_PROFILE_ID,
        role: 'staff',
        name: 'Priya',
      });
      expect(result.refreshToken).not.toBe(presented);
      expect(prisma.refreshSession.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.refreshSession.create).toHaveBeenCalledTimes(1);
      const created = prisma.refreshSession.create.mock.calls[0]?.[0] as {
        data: { tokenHash: string };
      };
      expect(created.data.tokenHash).toBe(hashRefreshToken(result.refreshToken));
    });

    async function expectRefreshRejected(): Promise<void> {
      try {
        await service.refresh({ refreshToken: presented });
        throw new Error('expected refresh to fail');
      } catch (error) {
        expectInvalidCredentials(error);
      }
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
      expect(prisma.refreshSession.create).not.toHaveBeenCalled();
      expect(tokens.signAccessToken).not.toHaveBeenCalled();
    }

    it('returns Invalid credentials for an unknown refresh token', async () => {
      prisma.refreshSession.findUnique.mockResolvedValue(null);
      await expectRefreshRejected();
    });

    it('returns Invalid credentials for a revoked refresh token', async () => {
      prisma.refreshSession.findUnique.mockResolvedValue({
        ...activeRefreshSession(),
        revokedAt: new Date('2020-01-01T00:00:00.000Z'),
      });
      await expectRefreshRejected();
    });

    it('returns Invalid credentials for an expired refresh token', async () => {
      prisma.refreshSession.findUnique.mockResolvedValue({
        ...activeRefreshSession(),
        expiresAt: new Date(Date.now() - 1_000),
      });
      await expectRefreshRejected();
    });

    const inactiveStatuses = ['PENDING', 'REJECTED', 'DEACTIVATED'] as const;

    it.each(inactiveStatuses)(
      'returns Invalid credentials for a %s user',
      async (status) => {
        prisma.refreshSession.findUnique.mockResolvedValue(
          activeRefreshSession('ADMIN', status),
        );
        await expectRefreshRejected();
      },
    );

    it('does not issue a new session when the old session cannot be revoked', async () => {
      prisma.refreshSession.updateMany.mockResolvedValue({ count: 0 });

      try {
        await service.refresh({ refreshToken: presented });
        throw new Error('expected refresh to fail');
      } catch (error) {
        expectInvalidCredentials(error);
      }

      expect(prisma.refreshSession.create).not.toHaveBeenCalled();
      expect(tokens.signAccessToken).not.toHaveBeenCalled();
    });

    it('hashes the supplied refresh token without trimming it', async () => {
      const refreshToken = '  not-trimmed  ';
      prisma.refreshSession.findUnique.mockResolvedValue(null);

      await expect(service.refresh({ refreshToken })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.refreshSession.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashRefreshToken(refreshToken) },
        }),
      );
    });
  });

  describe('logout', () => {
    const presented = PRESENTED_REFRESH_TOKEN;

    it('revokes an existing active session and returns no tokens', async () => {
      prisma.refreshSession.findUnique.mockResolvedValue({
        id: SESSION_ID,
        revokedAt: null,
      });

      const result = await service.logout({ refreshToken: presented });

      expect(result).toEqual({ success: true });
      expect(Object.keys(result)).toEqual(['success']);
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
      expect(prisma.refreshSession.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: hashRefreshToken(presented) },
        select: { id: true, revokedAt: true },
      });
      expect(prisma.refreshSession.update).toHaveBeenCalledWith({
        where: { id: SESSION_ID },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.refreshSession.create).not.toHaveBeenCalled();
      expect(tokens.signAccessToken).not.toHaveBeenCalled();

      const writes = JSON.stringify({
        update: prisma.refreshSession.update.mock.calls,
        create: prisma.refreshSession.create.mock.calls,
      });
      expect(writes).not.toContain(presented);
      expect(writes).not.toContain(hashRefreshToken(presented));
    });

    it('is idempotent when logout is repeated', async () => {
      let revokedAt: Date | null = null;
      prisma.refreshSession.findUnique.mockImplementation(async () => ({
        id: SESSION_ID,
        revokedAt,
      }));
      prisma.refreshSession.update.mockImplementation(
        async (args: { data: { revokedAt: Date } }) => {
          revokedAt = args.data.revokedAt;
          return { id: SESSION_ID };
        },
      );

      await expect(service.logout({ refreshToken: presented })).resolves.toEqual({
        success: true,
      });
      await expect(service.logout({ refreshToken: presented })).resolves.toEqual({
        success: true,
      });

      expect(prisma.refreshSession.update).toHaveBeenCalledTimes(1);
      expect(prisma.refreshSession.create).not.toHaveBeenCalled();
      expect(tokens.signAccessToken).not.toHaveBeenCalled();
    });

    it('returns success for an unknown refresh token', async () => {
      prisma.refreshSession.findUnique.mockResolvedValue(null);

      await expect(
        service.logout({ refreshToken: 'missing-refresh-token' }),
      ).resolves.toEqual({ success: true });

      expect(prisma.refreshSession.update).not.toHaveBeenCalled();
      expect(prisma.refreshSession.create).not.toHaveBeenCalled();
      expect(tokens.signAccessToken).not.toHaveBeenCalled();
      expect(JSON.stringify(prisma.refreshSession.findUnique.mock.calls)).not.toContain(
        'missing-refresh-token',
      );
    });
  });

  describe('getCurrentUser', () => {
    function expectCurrentUserSelect(): void {
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: USER_ID },
        select: {
          id: true,
          name: true,
          role: true,
          status: true,
        },
      });
      const query = prisma.user.findUnique.mock.calls[0]?.[0] as {
        select: Record<string, unknown>;
      };
      expect(query.select).not.toHaveProperty('passwordHash');
      expect(query.select).not.toHaveProperty('mobile');
      expect(query.select).not.toHaveProperty('permissions');
      expect(query.select).not.toHaveProperty('refreshSessions');
    }

    it('returns an active admin with the frontend admin role', async () => {
      const result = await service.getCurrentUser(currentUser('ADMIN'));

      expectCurrentUserSelect();
      expect(result).toEqual({
        id: USER_ID,
        organizationId: BUSINESS_PROFILE_ID,
        role: 'admin',
        name: 'Ada',
      });
      expect(Object.keys(result).sort()).toEqual([
        'id',
        'name',
        'organizationId',
        'role',
      ]);
      expect(result).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(result)).not.toMatch(
        /passwordHash|permissions|accessToken|refreshToken|refreshSessions/i,
      );
    });

    it('returns an active staff user with the frontend staff role', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userRow({ role: 'STAFF', name: 'Priya' }),
      );

      const result = await service.getCurrentUser(currentUser('STAFF'));

      expectCurrentUserSelect();
      expect(result).toEqual({
        id: USER_ID,
        organizationId: BUSINESS_PROFILE_ID,
        role: 'staff',
        name: 'Priya',
      });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('returns Invalid credentials for an unknown user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      try {
        await service.getCurrentUser(currentUser());
        throw new Error('expected getCurrentUser to fail');
      } catch (error) {
        expectInvalidCredentials(error);
      }
    });

    const inactiveStatuses = ['PENDING', 'REJECTED', 'DEACTIVATED'] as const;

    it.each(inactiveStatuses)(
      'returns Invalid credentials for a %s user',
      async (status) => {
        prisma.user.findUnique.mockResolvedValue(userRow({ status }));

        try {
          await service.getCurrentUser(currentUser());
          throw new Error('expected getCurrentUser to fail');
        } catch (error) {
          expectInvalidCredentials(error);
        }
      },
    );

    it('returns Invalid credentials when the token organization does not match', async () => {
      try {
        await service.getCurrentUser(currentUser('ADMIN', 'other-organization'));
        throw new Error('expected getCurrentUser to fail');
      } catch (error) {
        expectInvalidCredentials(error);
      }
    });
  });
});

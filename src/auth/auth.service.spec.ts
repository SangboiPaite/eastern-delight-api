import {
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import { AuthService } from './auth.service.js';
import { INVALID_CREDENTIALS } from './auth.types.js';
import type { LoginDto } from './dto/login.dto.js';
import { PasswordService } from './password.service.js';
import { hashRefreshToken } from './refresh-token.js';
import { TokenService } from './token.service.js';

const ORGANIZATION_SLUG = 'eastern-delight';
const BUSINESS_PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';

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
    refreshSession: { create: vi.fn() },
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
    prisma.refreshSession.create.mockReset().mockResolvedValue({ id: 'session-1' });
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
});

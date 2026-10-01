import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccessTokenGuard } from './access-token.guard.js';
import type {
  AccessTokenRequest,
  CurrentUserContext,
} from './current-user.js';
import { TokenService } from './token.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const ACCESS_TOKEN = 'access.jwt.token';

function httpContext(authorization?: unknown) {
  const request: AccessTokenRequest = {
    headers: { authorization },
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
  return { context, request };
}

describe('AccessTokenGuard', () => {
  const tokens = { verifyAccessToken: vi.fn() };
  const guard = new AccessTokenGuard(tokens as unknown as TokenService);

  beforeEach(() => {
    tokens.verifyAccessToken.mockReset();
  });

  async function expectRejected(authorization?: unknown): Promise<void> {
    const { context, request } = httpContext(authorization);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
    expect(request.user).toBeUndefined();
  }

  it.each(['ADMIN', 'STAFF'] as const)(
    'accepts a Bearer token and attaches the %s user from verified claims',
    async (role) => {
      tokens.verifyAccessToken.mockResolvedValue({
        sub: USER_ID,
        org: ORGANIZATION_ID,
        role,
      });
      const { context, request } = httpContext(`Bearer ${ACCESS_TOKEN}`);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(tokens.verifyAccessToken).toHaveBeenCalledTimes(1);
      expect(tokens.verifyAccessToken).toHaveBeenCalledWith(ACCESS_TOKEN);

      const user: CurrentUserContext = {
        id: USER_ID,
        organizationId: ORGANIZATION_ID,
        role,
      };
      expect(request.user).toEqual(user);
      expect(Object.keys(request.user ?? {}).sort()).toEqual([
        'id',
        'organizationId',
        'role',
      ]);
    },
  );

  it('verifies through TokenService without JwtService or Prisma', async () => {
    tokens.verifyAccessToken.mockResolvedValue({
      sub: USER_ID,
      org: ORGANIZATION_ID,
      role: 'ADMIN',
    });
    const module = await Test.createTestingModule({
      providers: [
        AccessTokenGuard,
        { provide: TokenService, useValue: tokens },
      ],
    }).compile();
    const diGuard = module.get(AccessTokenGuard);
    const { context } = httpContext(`Bearer ${ACCESS_TOKEN}`);

    await expect(diGuard.canActivate(context)).resolves.toBe(true);
    expect(tokens.verifyAccessToken).toHaveBeenCalledWith(ACCESS_TOKEN);
  });

  it('rejects a missing Authorization header', async () => {
    const { context, request } = httpContext();
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
    expect(request.user).toBeUndefined();
  });

  it.each([
    ['an array', ['Bearer access.jwt.token']],
    ['a number', 123],
  ])('rejects a non-string Authorization header (%s)', async (_name, header) => {
    await expectRejected(header);
  });

  it.each(['Bearer', 'Bearer '])(
    'rejects a missing Bearer token (%j)',
    async (header) => {
      await expectRejected(header);
    },
  );

  it.each(['Basic access.jwt.token', 'bearer access.jwt.token'])(
    'rejects the wrong authorization scheme (%j)',
    async (header) => {
      await expectRejected(header);
    },
  );

  it.each(['Bearer access.jwt.token extra', 'Bearer  access.jwt.token'])(
    'rejects a malformed Bearer header (%j)',
    async (header) => {
      await expectRejected(header);
    },
  );

  it('rethrows UnauthorizedException from TokenService', async () => {
    const error = new UnauthorizedException();
    tokens.verifyAccessToken.mockRejectedValue(error);
    const { context, request } = httpContext(`Bearer ${ACCESS_TOKEN}`);

    await expect(guard.canActivate(context)).rejects.toBe(error);
    expect(request.user).toBeUndefined();
  });
});

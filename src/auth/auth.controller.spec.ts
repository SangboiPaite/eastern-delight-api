import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';
import type {
  AuthLogoutResponse,
  AuthTokenResponse,
  AuthUserResponse,
} from './auth.types.js';
import type { CurrentUserContext } from './current-user.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';

describe('AuthController', () => {
  it('posts login DTOs to AuthService and returns the service result', async () => {
    const response: AuthTokenResponse = {
      accessToken: 'access',
      refreshToken: 'refresh',
      tokenType: 'Bearer',
      expiresIn: '15m',
      user: {
        id: 'user-1',
        organizationId: 'org-1',
        role: 'admin',
        name: 'Ada',
      },
    };
    const auth = { login: vi.fn().mockResolvedValue(response) };
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: TokenService, useValue: { verifyAccessToken: vi.fn() } },
      ],
    }).compile();

    const controller = module.get(AuthController);
    const dto = {
      mobile: '9876543210',
      password: 'secret',
      organizationSlug: 'eastern-delight',
    } as LoginDto;

    await expect(controller.login(dto)).resolves.toEqual(response);
    expect(auth.login).toHaveBeenCalledWith(dto);
  });

  it('posts refresh DTOs to AuthService and returns the service result', async () => {
    const response: AuthTokenResponse = {
      accessToken: 'next-access',
      refreshToken: 'next-refresh',
      tokenType: 'Bearer',
      expiresIn: '15m',
      user: {
        id: 'user-1',
        organizationId: 'org-1',
        role: 'staff',
        name: 'Priya',
      },
    };
    const auth = { refresh: vi.fn().mockResolvedValue(response) };
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: TokenService, useValue: { verifyAccessToken: vi.fn() } },
      ],
    }).compile();

    const controller = module.get(AuthController);
    const dto = { refreshToken: 'opaque-token' } as RefreshTokenDto;

    await expect(controller.refresh(dto)).resolves.toEqual(response);
    expect(auth.refresh).toHaveBeenCalledWith(dto);
  });

  it('posts logout DTOs to AuthService and returns the service result', async () => {
    const response: AuthLogoutResponse = { success: true };
    const auth = { logout: vi.fn().mockResolvedValue(response) };
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: TokenService, useValue: { verifyAccessToken: vi.fn() } },
      ],
    }).compile();

    const controller = module.get(AuthController);
    const dto = { refreshToken: 'opaque-token' } as RefreshTokenDto;

    await expect(controller.logout(dto)).resolves.toEqual({ success: true });
    expect(auth.logout).toHaveBeenCalledWith(dto);
    expect(response).not.toHaveProperty('accessToken');
    expect(response).not.toHaveProperty('refreshToken');
  });

  it('protects GET /auth/me and returns the current user from AuthService', async () => {
    const response: AuthUserResponse = {
      id: 'user-1',
      organizationId: 'org-1',
      role: 'admin',
      name: 'Ada',
    };
    const currentUser: CurrentUserContext = {
      id: 'user-1',
      organizationId: 'org-1',
      role: 'ADMIN',
    };
    const auth = { getCurrentUser: vi.fn().mockResolvedValue(response) };
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: TokenService, useValue: { verifyAccessToken: vi.fn() } },
      ],
    }).compile();
    const controller = module.get(AuthController);

    expect(Reflect.getMetadata(PATH_METADATA, AuthController)).toBe('auth');
    expect(Reflect.getMetadata(PATH_METADATA, AuthController.prototype.me)).toBe(
      'me',
    );
    expect(
      Reflect.getMetadata(METHOD_METADATA, AuthController.prototype.me),
    ).toBe(RequestMethod.GET);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.me),
    ).toContain(AccessTokenGuard);
    for (const route of ['login', 'refresh', 'logout'] as const) {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype[route]),
      ).toBeUndefined();
    }

    const metadata = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      AuthController,
      'me',
    ) as Record<string, { factory: (...args: unknown[]) => unknown }>;
    const factory = Object.values(metadata)[0]?.factory;
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: currentUser }),
      }),
    };
    expect(factory?.(undefined, context)).toBe(currentUser);

    await expect(controller.me(currentUser)).resolves.toEqual(response);
    expect(auth.getCurrentUser).toHaveBeenCalledWith(currentUser);
  });
});

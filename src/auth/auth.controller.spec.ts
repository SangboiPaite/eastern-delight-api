import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import type {
  AuthLogoutResponse,
  AuthTokenResponse,
} from './auth.types.js';
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
      providers: [{ provide: AuthService, useValue: auth }],
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
      providers: [{ provide: AuthService, useValue: auth }],
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
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();

    const controller = module.get(AuthController);
    const dto = { refreshToken: 'opaque-token' } as RefreshTokenDto;

    await expect(controller.logout(dto)).resolves.toEqual({ success: true });
    expect(auth.logout).toHaveBeenCalledWith(dto);
    expect(response).not.toHaveProperty('accessToken');
    expect(response).not.toHaveProperty('refreshToken');
  });
});

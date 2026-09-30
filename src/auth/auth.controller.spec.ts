import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import type { AuthTokenResponse } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';

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
});

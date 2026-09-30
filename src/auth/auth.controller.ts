import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type {
  AuthLogoutResponse,
  AuthTokenResponse,
} from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto): Promise<AuthTokenResponse> {
    return this.auth.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokenResponse> {
    return this.auth.refresh(dto);
  }

  @Post('logout')
  logout(@Body() dto: RefreshTokenDto): Promise<AuthLogoutResponse> {
    return this.auth.logout(dto);
  }
}

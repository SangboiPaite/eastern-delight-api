import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthService } from './auth.service.js';
import type {
  AuthLogoutResponse,
  AuthTokenResponse,
  AuthUserResponse,
} from './auth.types.js';
import type { CurrentUserContext } from './current-user.js';
import { CurrentUser } from './current-user.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() dto: LoginDto): Promise<AuthTokenResponse> {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokenResponse> {
    return this.auth.refresh(dto);
  }

  @Post('logout')
  logout(@Body() dto: RefreshTokenDto): Promise<AuthLogoutResponse> {
    return this.auth.logout(dto);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(
    @CurrentUser() currentUser: CurrentUserContext,
  ): Promise<AuthUserResponse> {
    return this.auth.getCurrentUser(currentUser);
  }
}

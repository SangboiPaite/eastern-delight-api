import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AccessTokenRole } from './access-token.js';
import {
  INVALID_CREDENTIALS,
  toAuthAppRole,
  type AuthTokenResponse,
} from './auth.types.js';
import { expiryFromDuration } from './duration.js';
import type { LoginDto } from './dto/login.dto.js';
import { normalizeMobile } from './normalize-mobile.js';
import { PasswordService } from './password.service.js';
import {
  generateRefreshToken,
  hashRefreshToken,
} from './refresh-token.js';
import { TokenService } from './token.service.js';

const USER_LOGIN_SELECT = {
  id: true,
  name: true,
  role: true,
  status: true,
  passwordHash: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<AppConfiguration, true>,
  ) {}

  async login(dto: LoginDto): Promise<AuthTokenResponse> {
    const organizationId = await this.requireSingleBusinessProfileId();
    this.assertOrganizationSlug(dto.organizationSlug);

    const user = await this.prisma.user.findUnique({
      where: { mobile: normalizeMobile(dto.mobile) },
      select: USER_LOGIN_SELECT,
    });

    if (!user) {
      this.rejectCredentials();
    }

    const passwordOk = await this.passwords
      .verify(user.passwordHash, dto.password)
      .catch(() => false);

    if (!passwordOk || user.status !== 'ACTIVE') {
      this.rejectCredentials();
    }

    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      org: organizationId,
      role: user.role as AccessTokenRole,
    });

    const refreshToken = generateRefreshToken();
    const refreshTtl = this.config.getOrThrow('refreshTokenExpiresIn', {
      infer: true,
    });
    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: expiryFromDuration(refreshTtl),
      },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.getOrThrow('jwtAccessExpiresIn', { infer: true }),
      user: {
        id: user.id,
        organizationId,
        role: toAuthAppRole(user.role as AccessTokenRole),
        name: user.name,
      },
    };
  }

  private async requireSingleBusinessProfileId(): Promise<string> {
    const profiles = await this.prisma.businessProfile.findMany({
      select: { id: true },
      take: 2,
    });
    if (profiles.length !== 1) {
      throw new InternalServerErrorException();
    }
    return profiles[0].id;
  }

  private assertOrganizationSlug(organizationSlug: string): void {
    const expected = this.config.getOrThrow('organizationSlug', {
      infer: true,
    });
    if (organizationSlug.trim() !== expected.trim()) {
      this.rejectCredentials();
    }
  }

  private rejectCredentials(): never {
    throw new UnauthorizedException(INVALID_CREDENTIALS);
  }
}

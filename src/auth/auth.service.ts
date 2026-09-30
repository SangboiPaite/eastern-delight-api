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
  type AuthLogoutResponse,
  type AuthTokenResponse,
} from './auth.types.js';
import { expiryFromDuration } from './duration.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RefreshTokenDto } from './dto/refresh-token.dto.js';
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

const REFRESH_SESSION_AUTH_SELECT = {
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

  async refresh(dto: RefreshTokenDto): Promise<AuthTokenResponse> {
    const organizationId = await this.requireSingleBusinessProfileId();
    const presentedHash = hashRefreshToken(dto.refreshToken);
    const now = new Date();
    const refreshTtl = this.config.getOrThrow('refreshTokenExpiresIn', {
      infer: true,
    });

    const rotated = await this.prisma.$transaction(async (tx) => {
      const session = await tx.refreshSession.findUnique({
        where: { tokenHash: presentedHash },
        select: REFRESH_SESSION_AUTH_SELECT,
      });

      if (
        !session ||
        session.revokedAt !== null ||
        session.expiresAt.getTime() <= now.getTime() ||
        session.user.status !== 'ACTIVE'
      ) {
        return null;
      }

      const refreshToken = generateRefreshToken();
      const revoked = await tx.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (revoked.count !== 1) {
        return null;
      }

      await tx.refreshSession.create({
        data: {
          userId: session.user.id,
          tokenHash: hashRefreshToken(refreshToken),
          expiresAt: expiryFromDuration(refreshTtl, now),
        },
      });

      const accessToken = await this.tokens.signAccessToken({
        sub: session.user.id,
        org: organizationId,
        role: session.user.role,
      });

      return {
        accessToken,
        refreshToken,
        user: session.user,
      };
    });

    if (!rotated) {
      this.rejectCredentials();
    }

    return {
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.getOrThrow('jwtAccessExpiresIn', { infer: true }),
      user: {
        id: rotated.user.id,
        organizationId,
        role: toAuthAppRole(rotated.user.role),
        name: rotated.user.name,
      },
    };
  }

  async logout(dto: RefreshTokenDto): Promise<AuthLogoutResponse> {
    const tokenHash = hashRefreshToken(dto.refreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      select: { id: true, revokedAt: true },
    });

    if (session && session.revokedAt === null) {
      await this.prisma.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
    }

    return { success: true };
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

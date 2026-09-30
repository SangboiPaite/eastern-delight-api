import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  isAccessTokenRole,
  type AccessTokenClaims,
} from './access-token.js';

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync({
      sub: claims.sub,
      org: claims.org,
      role: claims.role,
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(token);
    } catch {
      throw new UnauthorizedException();
    }

    const sub = payload.sub;
    const org = payload.org;
    const role = payload.role;
    if (
      typeof sub !== 'string' ||
      sub.length < 1 ||
      typeof org !== 'string' ||
      org.length < 1 ||
      !isAccessTokenRole(role)
    ) {
      throw new UnauthorizedException();
    }

    return { sub, org, role };
  }
}

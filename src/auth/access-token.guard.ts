import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AccessTokenRequest } from './current-user.js';
import { TokenService } from './token.service.js';

function readBearerToken(authorization: unknown): string {
  if (typeof authorization !== 'string') {
    throw new UnauthorizedException();
  }

  const separator = authorization.indexOf(' ');
  if (separator <= 0) {
    throw new UnauthorizedException();
  }

  const scheme = authorization.slice(0, separator);
  const token = authorization.slice(separator + 1);
  if (scheme !== 'Bearer' || token.length === 0 || token.includes(' ')) {
    throw new UnauthorizedException();
  }

  return token;
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AccessTokenRequest>();
    const token = readBearerToken(request.headers?.authorization);
    const claims = await this.tokens.verifyAccessToken(token);
    request.user = {
      id: claims.sub,
      organizationId: claims.org,
      role: claims.role,
    };
    return true;
  }
}

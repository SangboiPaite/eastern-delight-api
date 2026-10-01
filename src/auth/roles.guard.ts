import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isAccessTokenRole, type AccessTokenRole } from './access-token.js';
import type { AccessTokenRequest } from './current-user.js';
import { ROLES_KEY } from './roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AccessTokenRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AccessTokenRequest>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException();
    }

    if (!isAccessTokenRole(user.role) || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException();
    }

    return true;
  }
}

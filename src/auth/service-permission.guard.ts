import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ServicePermission } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AccessTokenRequest } from './current-user.js';
import { SERVICE_PERMISSION_KEY } from './service-permission.decorator.js';

@Injectable()
export class ServicePermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredServices = this.reflector.getAllAndOverride<
      ServicePermission[]
    >(SERVICE_PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredServices || requiredServices.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AccessTokenRequest>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException();
    }

    const grants = await this.prisma.userServicePermission.findMany({
      where: {
        userId: user.id,
        service: { in: requiredServices },
      },
      select: { service: true },
    });
    const granted = new Set(grants.map((grant) => grant.service));
    if (requiredServices.some((service) => !granted.has(service))) {
      throw new ForbiddenException();
    }

    return true;
  }
}

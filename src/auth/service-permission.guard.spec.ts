import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { ServicePermission } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AccessTokenRole } from './access-token.js';
import type {
  AccessTokenRequest,
  CurrentUserContext,
} from './current-user.js';
import {
  RequireService,
  SERVICE_PERMISSION_KEY,
} from './service-permission.decorator.js';
import { ServicePermissionGuard } from './service-permission.guard.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';

function currentUser(role: AccessTokenRole): CurrentUserContext {
  return {
    id: USER_ID,
    organizationId: ORGANIZATION_ID,
    role,
  };
}

@RequireService('BILLING')
class BillingClassController {
  inherited() {}

  @RequireService('CUSTOMERS')
  methodOverridesClass() {}
}

class MethodPermissionController {
  @RequireService('BILLING')
  billingOnly() {}

  @RequireService('PRODUCTS')
  productsOnly() {}

  @RequireService('BILLING', 'CUSTOMERS')
  billingAndCustomers() {}

  open() {}
}

class OpenController {
  open() {}
}

type Handler = (...args: unknown[]) => void;

function httpContext(
  handler: Handler,
  classRef: new (...args: unknown[]) => unknown,
  user?: CurrentUserContext,
) {
  const request: AccessTokenRequest = {
    headers: {},
    user,
  };

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => handler,
    getClass: () => classRef,
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('RequireService', () => {
  it('stores BILLING as service-permission metadata', () => {
    expect(
      Reflect.getMetadata(
        SERVICE_PERMISSION_KEY,
        MethodPermissionController.prototype.billingOnly,
      ),
    ).toEqual(['BILLING']);
  });

  it('preserves every required service in order', () => {
    expect(
      Reflect.getMetadata(
        SERVICE_PERMISSION_KEY,
        MethodPermissionController.prototype.billingAndCustomers,
      ),
    ).toEqual(['BILLING', 'CUSTOMERS']);

    expect(
      Reflect.getMetadata(SERVICE_PERMISSION_KEY, BillingClassController),
    ).toEqual(['BILLING']);
  });
});

describe('ServicePermissionGuard', () => {
  const prisma = {
    userServicePermission: { findMany: vi.fn() },
  };

  const guard = new ServicePermissionGuard(
    new Reflector(),
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    prisma.userServicePermission.findMany.mockReset();
  });

  function activate(
    handler: Handler,
    classRef: new (...args: unknown[]) => unknown,
    user?: CurrentUserContext,
  ) {
    return httpContext(handler, classRef, user);
  }

  function grant(...services: ServicePermission[]): void {
    prisma.userServicePermission.findMany.mockResolvedValue(
      services.map((service) => ({ service })),
    );
  }

  function permissionQuery(): {
    where: { userId?: string; service?: { in: ServicePermission[] } };
    select: Record<string, unknown>;
  } {
    return prisma.userServicePermission.findMany.mock.calls[0]?.[0] as {
      where: { userId?: string; service?: { in: ServicePermission[] } };
      select: Record<string, unknown>;
    };
  }

  it('allows a request when no @RequireService metadata exists', async () => {
    const { context } = activate(OpenController.prototype.open, OpenController);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.userServicePermission.findMany).not.toHaveBeenCalled();
  });

  it('allows an authenticated user when neither method nor class declares services', async () => {
    const { context, request } = activate(
      OpenController.prototype.open,
      OpenController,
      currentUser('ADMIN'),
    );
    const userBefore = request.user;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.userServicePermission.findMany).not.toHaveBeenCalled();
    expect(request.user).toBe(userBefore);
  });

  it('allows a user who has BILLING', async () => {
    grant('BILLING');
    const user = currentUser('STAFF');
    const { context, request } = activate(
      MethodPermissionController.prototype.billingOnly,
      MethodPermissionController,
      user,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(permissionQuery()).toEqual({
      where: { userId: USER_ID, service: { in: ['BILLING'] } },
      select: { service: true },
    });

    expect(permissionQuery().where).not.toHaveProperty('organizationId');
    expect(JSON.stringify(permissionQuery())).not.toContain(ORGANIZATION_ID);
    expect(request.user).toBe(user);
  });

  it('allows a user who has PRODUCTS', async () => {
    grant('PRODUCTS');
    const { context } = activate(
      MethodPermissionController.prototype.productsOnly,
      MethodPermissionController,
      currentUser('ADMIN'),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionQuery().where.service).toEqual({
      in: ['PRODUCTS'],
    });
    expect(permissionQuery().select).toEqual({
      service: true,
    });
  });

  it('allows a user only when every required permission is stored', async () => {
    grant('CUSTOMERS', 'BILLING');
    const { context } = activate(
      MethodPermissionController.prototype.billingAndCustomers,
      MethodPermissionController,
      currentUser('STAFF'),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(permissionQuery().where).toEqual({
      userId: USER_ID,
      service: { in: ['BILLING', 'CUSTOMERS'] },
    });
  });

  it('rejects when one required permission is missing', async () => {
    grant('BILLING');

    const { context, request } = activate(
      MethodPermissionController.prototype.billingAndCustomers,
      MethodPermissionController,
      currentUser('ADMIN'),
    );

    const userBefore = request.user;

    const error = await guard
      .canActivate(context)
      .catch((error: unknown) => error);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error).toMatchObject({ status: 403 });
    expect(request.user).toBe(userBefore);
  });

  it('rejects when every required permission is missing', async () => {
    grant();

    const { context } = activate(
      MethodPermissionController.prototype.billingAndCustomers,
      MethodPermissionController,
      currentUser('STAFF'),
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a missing user with UnauthorizedException', async () => {
    const { context, request } = activate(
      MethodPermissionController.prototype.billingOnly,
      MethodPermissionController,
    );

    const error = await guard
      .canActivate(context)
      .catch((error: unknown) => error);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error).toMatchObject({ status: 401 });
    expect(prisma.userServicePermission.findMany).not.toHaveBeenCalled();
    expect(request.user).toBeUndefined();
  });

  it('propagates a database error instead of authorizing', async () => {
    const failure = new Error('connection reset');

    prisma.userServicePermission.findMany.mockRejectedValue(failure);

    const { context } = activate(
      MethodPermissionController.prototype.billingOnly,
      MethodPermissionController,
      currentUser('ADMIN'),
    );

    await expect(guard.canActivate(context)).rejects.toBe(failure);
  });

  it.each(['ADMIN', 'STAFF'] as const)(
    'does not grant %s a permission that is not stored',
    async (role) => {
      grant();

      const { context } = activate(
        MethodPermissionController.prototype.billingOnly,
        MethodPermissionController,
        currentUser(role),
      );

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      expect(permissionQuery().where).toEqual({
        userId: USER_ID,
        service: { in: ['BILLING'] },
      });

      expect(permissionQuery().where).not.toHaveProperty('role');
    },
  );

  it('reads the user id through Nest dependency injection', async () => {
    grant('BILLING');

    const module = await Test.createTestingModule({
      providers: [
        ServicePermissionGuard,
        Reflector,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    const diGuard = module.get(ServicePermissionGuard);
    const user = currentUser('ADMIN');

    const { context, request } = activate(
      MethodPermissionController.prototype.billingOnly,
      MethodPermissionController,
      user,
    );

    await expect(diGuard.canActivate(context)).resolves.toBe(true);

    expect(permissionQuery().where.userId).toBe(USER_ID);
    expect(permissionQuery().select).toEqual({
      service: true,
    });
    expect(request.user).toEqual(user);
  });

  it('enforces class-level @RequireService when the method has none', async () => {
    grant('BILLING');

    const allowed = activate(
      BillingClassController.prototype.inherited,
      BillingClassController,
      currentUser('STAFF'),
    );

    await expect(guard.canActivate(allowed.context)).resolves.toBe(true);

    expect(permissionQuery().where.service).toEqual({
      in: ['BILLING'],
    });

    grant();

    const denied = activate(
      BillingClassController.prototype.inherited,
      BillingClassController,
      currentUser('ADMIN'),
    );

    await expect(guard.canActivate(denied.context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets method-level @RequireService override class-level metadata', async () => {
    grant('CUSTOMERS');

    const allowed = activate(
      BillingClassController.prototype.methodOverridesClass,
      BillingClassController,
      currentUser('STAFF'),
    );

    await expect(guard.canActivate(allowed.context)).resolves.toBe(true);

    expect(permissionQuery().where.service).toEqual({
      in: ['CUSTOMERS'],
    });

    grant('BILLING');

    const denied = activate(
      BillingClassController.prototype.methodOverridesClass,
      BillingClassController,
      currentUser('ADMIN'),
    );

    await expect(guard.canActivate(denied.context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(permissionQuery().where.service).toEqual({
      in: ['CUSTOMERS'],
    });
  });
});
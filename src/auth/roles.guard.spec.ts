import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { AccessTokenRole } from './access-token.js';
import type {
  AccessTokenRequest,
  CurrentUserContext,
} from './current-user.js';
import { ROLES_KEY, Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';

function currentUser(role: AccessTokenRole): CurrentUserContext {
  return {
    id: USER_ID,
    organizationId: ORGANIZATION_ID,
    role,
  };
}

@Roles('ADMIN')
class AdminClassController {
  inherited() {}

  @Roles('STAFF')
  methodOverridesClass() {}
}

@Roles('STAFF')
class StaffClassController {
  inherited() {}
}

class MethodRoleController {
  @Roles('ADMIN')
  adminOnly() {}

  @Roles('STAFF')
  staffOnly() {}

  @Roles('ADMIN', 'STAFF')
  eitherRole() {}

  open() {}
}

class OpenController {
  open() {}
}

class UnknownRoleController {
  unknown() {}
}

Reflect.defineMetadata(
  ROLES_KEY,
  ['OWNER'],
  UnknownRoleController.prototype.unknown,
);

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

describe('Roles', () => {
  it('stores ADMIN as role metadata', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, MethodRoleController.prototype.adminOnly),
    ).toEqual(['ADMIN']);
  });

  it('preserves multiple roles in order', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, MethodRoleController.prototype.eitherRole),
    ).toEqual(['ADMIN', 'STAFF']);
    expect(Reflect.getMetadata(ROLES_KEY, AdminClassController)).toEqual([
      'ADMIN',
    ]);
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  function activate(
    handler: Handler,
    classRef: new (...args: unknown[]) => unknown,
    user?: CurrentUserContext,
  ) {
    return httpContext(handler, classRef, user);
  }

  it('allows a request when no @Roles metadata exists', () => {
    const { context } = activate(
      OpenController.prototype.open,
      OpenController,
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when neither method nor class declares roles', () => {
    const { context, request } = activate(
      OpenController.prototype.open,
      OpenController,
      currentUser('STAFF'),
    );
    const userBefore = request.user;

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toBe(userBefore);
  });

  it('allows ADMIN when the method requires ADMIN', () => {
    const { context } = activate(
      MethodRoleController.prototype.adminOnly,
      MethodRoleController,
      currentUser('ADMIN'),
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows STAFF when the method requires STAFF', () => {
    const { context } = activate(
      MethodRoleController.prototype.staffOnly,
      MethodRoleController,
      currentUser('STAFF'),
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it.each(['ADMIN', 'STAFF'] as const)(
    'allows %s when the method accepts ADMIN or STAFF',
    (role) => {
      const { context } = activate(
        MethodRoleController.prototype.eitherRole,
        MethodRoleController,
        currentUser(role),
      );

      expect(guard.canActivate(context)).toBe(true);
    },
  );

  it('rejects STAFF with ForbiddenException when only ADMIN is required', () => {
    const { context, request } = activate(
      MethodRoleController.prototype.adminOnly,
      MethodRoleController,
      currentUser('STAFF'),
    );
    const userBefore = request.user;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    try {
      guard.canActivate(context);
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getStatus()).toBe(403);
    }
    expect(request.user).toBe(userBefore);
  });

  it('rejects ADMIN with ForbiddenException when only STAFF is required', () => {
    const { context } = activate(
      MethodRoleController.prototype.staffOnly,
      MethodRoleController,
      currentUser('ADMIN'),
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    try {
      guard.canActivate(context);
    } catch (error) {
      expect((error as ForbiddenException).getStatus()).toBe(403);
    }
  });

  it('rejects a missing user with UnauthorizedException when roles are required', () => {
    const { context, request } = activate(
      MethodRoleController.prototype.adminOnly,
      MethodRoleController,
    );

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    try {
      guard.canActivate(context);
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getStatus()).toBe(401);
      expect(error).not.toBeInstanceOf(ForbiddenException);
    }
    expect(request.user).toBeUndefined();
  });

  it.each(['OWNER', 'admin', ''])(
    'rejects unknown role %j instead of authorizing it',
    (role) => {
      const user = currentUser('ADMIN');
      user.role = role as AccessTokenRole;
      const { context } = activate(
        MethodRoleController.prototype.eitherRole,
        MethodRoleController,
        user,
      );

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    },
  );

  it('rejects an unknown role even when the metadata lists that role', () => {
    const user = currentUser('ADMIN');
    user.role = 'OWNER' as AccessTokenRole;
    const { context } = activate(
      UnknownRoleController.prototype.unknown,
      UnknownRoleController,
      user,
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('reads request.user and does not query Prisma', async () => {
    const module = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();
    const diGuard = module.get(RolesGuard);
    const user = currentUser('ADMIN');
    const { context, request } = activate(
      MethodRoleController.prototype.adminOnly,
      MethodRoleController,
      user,
    );

    expect(diGuard.canActivate(context)).toBe(true);
    expect(request.user).toBe(user);
    expect(request.user).toEqual({
      id: USER_ID,
      organizationId: ORGANIZATION_ID,
      role: 'ADMIN',
    });
  });

  it('enforces class-level @Roles when the method has none', () => {
    const allowed = activate(
      AdminClassController.prototype.inherited,
      AdminClassController,
      currentUser('ADMIN'),
    );
    const denied = activate(
      AdminClassController.prototype.inherited,
      AdminClassController,
      currentUser('STAFF'),
    );
    const staffAllowed = activate(
      StaffClassController.prototype.inherited,
      StaffClassController,
      currentUser('STAFF'),
    );

    expect(guard.canActivate(allowed.context)).toBe(true);
    expect(() => guard.canActivate(denied.context)).toThrow(ForbiddenException);
    expect(guard.canActivate(staffAllowed.context)).toBe(true);
  });

  it('lets method-level @Roles override class-level @Roles', () => {
    const staffAllowed = activate(
      AdminClassController.prototype.methodOverridesClass,
      AdminClassController,
      currentUser('STAFF'),
    );
    const adminDenied = activate(
      AdminClassController.prototype.methodOverridesClass,
      AdminClassController,
      currentUser('ADMIN'),
    );

    expect(guard.canActivate(staffAllowed.context)).toBe(true);
    expect(() => guard.canActivate(adminDenied.context)).toThrow(
      ForbiddenException,
    );
  });
});

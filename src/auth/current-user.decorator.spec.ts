import { type ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { CurrentUserContext } from './current-user.js';
import { CurrentUser } from './current-user.decorator.js';

describe('CurrentUser', () => {
  it('returns request.user', () => {
    class Probe {
      handler(@CurrentUser() _user: CurrentUserContext) {
        return _user;
      }
    }

    const metadata = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      Probe,
      'handler',
    ) as Record<string, { factory: (...args: unknown[]) => unknown }>;
    const factory = Object.values(metadata)[0]?.factory;
    const user: CurrentUserContext = {
      id: 'user-1',
      organizationId: 'org-1',
      role: 'STAFF',
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as ExecutionContext;

    expect(factory).toEqual(expect.any(Function));
    expect(factory?.(undefined, context)).toBe(user);
  });
});

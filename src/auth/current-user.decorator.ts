import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type {
  AccessTokenRequest,
  CurrentUserContext,
} from './current-user.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserContext => {
    const request = context.switchToHttp().getRequest<AccessTokenRequest>();
    return request.user as CurrentUserContext;
  },
);

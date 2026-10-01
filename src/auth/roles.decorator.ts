import { SetMetadata } from '@nestjs/common';
import type { AccessTokenRole } from './access-token.js';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: AccessTokenRole[]) =>
  SetMetadata(ROLES_KEY, roles);

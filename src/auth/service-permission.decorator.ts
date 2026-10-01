import { SetMetadata } from '@nestjs/common';
import type { ServicePermission } from '../../generated/prisma/client.js';

export const SERVICE_PERMISSION_KEY = 'servicePermissions';

export const RequireService = (...services: ServicePermission[]) =>
  SetMetadata(SERVICE_PERMISSION_KEY, services);

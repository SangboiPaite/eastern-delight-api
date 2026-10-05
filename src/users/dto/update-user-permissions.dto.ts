import { ArrayUnique, IsArray, IsEnum } from 'class-validator';
import { ServicePermission } from '../../../generated/prisma/client.js';

export class UpdateUserPermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsEnum(ServicePermission, { each: true })
  permissions: ServicePermission[];
}

import { IsEnum, IsOptional } from 'class-validator';
import { UserRole, UserStatus } from '../../../generated/prisma/client.js';

export class ListUsersDto {
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

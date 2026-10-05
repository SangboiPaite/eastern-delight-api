import type {
  ServicePermission,
  UserRole,
  UserStatus,
} from '../../../generated/prisma/client.js';

export type UserResponse = {
  id: string;
  name: string;
  mobile: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  permissions: ServicePermission[];
};

export type UserListResponse = {
  users: UserResponse[];
};

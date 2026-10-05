import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ListUsersDto } from './dto/list-users.dto.js';
import type {
  UserListResponse,
  UserResponse,
} from './dto/user-response.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() query: ListUsersDto): Promise<UserListResponse> {
    return this.users.listUsers(query);
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<UserResponse> {
    return this.users.getUserById(id);
  }
}

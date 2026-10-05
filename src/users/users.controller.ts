import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import type { CurrentUserContext } from '../auth/current-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { ListUsersDto } from './dto/list-users.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
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

  @Post()
  create(@Body() dto: CreateUserDto): Promise<UserResponse> {
    return this.users.createUser(dto);
  }

  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserContext,
  ): Promise<UserResponse> {
    return this.users.approveUser(id, currentUser);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserContext,
  ): Promise<UserResponse> {
    return this.users.rejectUser(id, currentUser);
  }

  @Post(':id/deactivate')
  deactivate(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserContext,
  ): Promise<UserResponse> {
    return this.users.deactivateUser(id, currentUser);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: CurrentUserContext,
  ): Promise<UserResponse> {
    return this.users.updateUser(id, dto, currentUser);
  }
}

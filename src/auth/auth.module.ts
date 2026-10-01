import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import type { AppConfiguration } from '../config/configuration.js';
import { DatabaseModule } from '../database/database.module.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { ServicePermissionGuard } from './service-permission.guard.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfiguration, true>) => ({
        secret: config.getOrThrow('jwtAccessSecret', { infer: true }),
        signOptions: {
          expiresIn: config.getOrThrow('jwtAccessExpiresIn', {
            infer: true,
          }) as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    PasswordService,
    TokenService,
    AuthService,
    AccessTokenGuard,
    ServicePermissionGuard,
  ],
  exports: [
    PasswordService,
    TokenService,
    AuthService,
    AccessTokenGuard,
    ServicePermissionGuard,
  ],
})
export class AuthModule {}

import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import helmet from 'helmet';

export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  return app;
}

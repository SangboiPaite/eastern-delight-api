import type { INestApplication } from '@nestjs/common';
import { configureApp } from './configure-app.js';

describe('configureApp', () => {
  it(
    'applies the /api prefix, shutdown hooks, Helmet, and a global ValidationPipe',
    () => {
      const app = {
        setGlobalPrefix: vi.fn().mockReturnThis(),
        enableShutdownHooks: vi.fn().mockReturnThis(),
        use: vi.fn().mockReturnThis(),
        useGlobalPipes: vi.fn().mockReturnThis(),
      };

      configureApp(app as unknown as INestApplication);

      expect(app.setGlobalPrefix).toHaveBeenCalledWith('api');
      expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
      expect(app.use).toHaveBeenCalledTimes(1);
      expect(app.use.mock.calls[0]?.[0]).toBeDefined();
      expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
      expect(app.useGlobalPipes.mock.calls[0]?.[0]).toBeDefined();
    },
    15000,
  );
});

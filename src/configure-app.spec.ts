import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { configureApp } from './configure-app.js';

@Module({})
class ProxyTrustProbeModule {}

describe('configureApp', () => {
  it(
    'applies the /api prefix, shutdown hooks, Helmet, and a global ValidationPipe',
    () => {
      const expressApp = { set: vi.fn() };
      const app = {
        setGlobalPrefix: vi.fn().mockReturnThis(),
        enableShutdownHooks: vi.fn().mockReturnThis(),
        use: vi.fn().mockReturnThis(),
        useGlobalPipes: vi.fn().mockReturnThis(),
        getHttpAdapter: vi.fn(() => ({ getInstance: () => expressApp })),
      };

      configureApp(app as unknown as INestApplication);

      expect(app.setGlobalPrefix).toHaveBeenCalledWith('api');
      expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
      expect(app.use).toHaveBeenCalledTimes(1);
      expect(app.use.mock.calls[0]?.[0]).toBeDefined();
      expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
      expect(app.useGlobalPipes.mock.calls[0]?.[0]).toBeDefined();
      expect(expressApp.set).toHaveBeenCalledTimes(1);
      expect(expressApp.set).toHaveBeenCalledWith('trust proxy', 'loopback');
    },
    15000,
  );

  it(
    'trusts only the loopback reverse proxy',
    async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ProxyTrustProbeModule],
      }).compile();
      const app = moduleRef.createNestApplication({ logger: false });
      configureApp(app);
      await app.init();

      try {
        const server = app.getHttpAdapter().getInstance() as {
          get(setting: string): unknown;
        };
        expect(server.get('trust proxy')).toBe('loopback');
      } finally {
        await app.close();
      }
    },
    15000,
  );
});

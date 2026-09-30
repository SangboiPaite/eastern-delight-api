import { configureApp } from './configure-app.js';

describe('configureApp', () => {
  it(
    'applies the /api prefix, shutdown hooks, and a global ValidationPipe',
    () => {
      const app = {
        setGlobalPrefix: vi.fn().mockReturnThis(),
        enableShutdownHooks: vi.fn().mockReturnThis(),
        useGlobalPipes: vi.fn().mockReturnThis(),
      };

      configureApp(app as never);

      expect(app.setGlobalPrefix).toHaveBeenCalledWith('api');
      expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
      expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
      expect(app.useGlobalPipes.mock.calls[0]?.[0]).toBeDefined();
    },
    15000,
  );
});

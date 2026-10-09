import { APP_GUARD } from '@nestjs/core';
import { getOptionsToken, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppModule } from './app.module.js';

type ProviderRecord = {
  provide?: unknown;
  useClass?: unknown;
  useValue?: unknown;
};

type ImportRecord = {
  module?: unknown;
  providers?: ProviderRecord[];
};

describe('AppModule', () => {
  it('registers a global throttler of 100 requests per 60 seconds', () => {
    const providers = Reflect.getMetadata('providers', AppModule) as ProviderRecord[];
    const imports = Reflect.getMetadata('imports', AppModule) as ImportRecord[];
    const throttler = imports.find((item) => item.module === ThrottlerModule);
    const options = throttler?.providers?.find(
      (provider) => provider.provide === getOptionsToken(),
    );

    expect(providers).toContainEqual({
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    });
    expect(options?.useValue).toEqual([
      {
        name: 'default',
        limit: 100,
        ttl: 60_000,
      },
    ]);
  });
});

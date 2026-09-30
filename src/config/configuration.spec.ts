import { loadConfiguration } from './configuration.js';

const ENV_KEYS = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_ACCESS_EXPIRES_IN',
  'REFRESH_TOKEN_SECRET',
  'REFRESH_TOKEN_EXPIRES_IN',
  'EASTERN_DELIGHT_ORGANIZATION_SLUG',
  'NODE_ENV',
] as const;

describe('loadConfiguration', () => {
  const original = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;

  function restoreEnv(): void {
    for (const key of ENV_KEYS) {
      const value = original[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  function applyValidEnv(): void {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      'postgresql://app:secret@127.0.0.1:5432/eastern_delight_unit';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
    process.env.REFRESH_TOKEN_SECRET = 'b'.repeat(32);
    process.env.EASTERN_DELIGHT_ORGANIZATION_SLUG = 'eastern-delight';
    delete process.env.JWT_ACCESS_EXPIRES_IN;
    delete process.env.REFRESH_TOKEN_EXPIRES_IN;
  }

  afterEach(() => {
    restoreEnv();
  });

  it('throws when DATABASE_URL is missing', () => {
    applyValidEnv();
    delete process.env.DATABASE_URL;

    expect(() => loadConfiguration()).toThrowError('DATABASE_URL is required');
  });

  it('throws when DATABASE_URL is blank', () => {
    applyValidEnv();
    process.env.DATABASE_URL = '   ';

    expect(() => loadConfiguration()).toThrowError('DATABASE_URL is required');
  });

  it('throws when JWT_ACCESS_SECRET is missing or too short', () => {
    applyValidEnv();
    delete process.env.JWT_ACCESS_SECRET;
    expect(() => loadConfiguration()).toThrowError('JWT_ACCESS_SECRET is required');

    process.env.JWT_ACCESS_SECRET = 'short';
    expect(() => loadConfiguration()).toThrowError('JWT_ACCESS_SECRET is invalid');
  });

  it('throws when access and refresh secrets are identical', () => {
    applyValidEnv();
    process.env.REFRESH_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET;

    expect(() => loadConfiguration()).toThrowError(
      'REFRESH_TOKEN_SECRET must differ from JWT_ACCESS_SECRET',
    );
  });

  it('throws when the organization slug is missing', () => {
    applyValidEnv();
    delete process.env.EASTERN_DELIGHT_ORGANIZATION_SLUG;

    expect(() => loadConfiguration()).toThrowError(
      'EASTERN_DELIGHT_ORGANIZATION_SLUG is required',
    );
  });

  it('uses development expiry defaults and does not log secrets', () => {
    applyValidEnv();

    const config = loadConfiguration();

    expect(config.jwtAccessExpiresIn).toBe('15m');
    expect(config.refreshTokenExpiresIn).toBe('7d');
    expect(config.organizationSlug).toBe('eastern-delight');
    expect(config.databaseUrl).toBe(
      'postgresql://app:secret@127.0.0.1:5432/eastern_delight_unit',
    );
    expect(Object.keys(config).sort()).toEqual(
      [
        'databaseUrl',
        'jwtAccessExpiresIn',
        'jwtAccessSecret',
        'organizationSlug',
        'refreshTokenExpiresIn',
        'refreshTokenSecret',
      ].sort(),
    );
  });

  it('requires expiry values in production', () => {
    applyValidEnv();
    process.env.NODE_ENV = 'production';

    expect(() => loadConfiguration()).toThrowError(
      'JWT_ACCESS_EXPIRES_IN is required',
    );

    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    expect(() => loadConfiguration()).toThrowError(
      'REFRESH_TOKEN_EXPIRES_IN is required',
    );
  });
});

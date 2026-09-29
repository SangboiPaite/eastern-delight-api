import { loadConfiguration } from './configuration.js';

describe('loadConfiguration', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('throws when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;

    expect(() => loadConfiguration()).toThrowError('DATABASE_URL is required');
  });

  it('throws when DATABASE_URL is blank', () => {
    process.env.DATABASE_URL = '   ';

    expect(() => loadConfiguration()).toThrowError('DATABASE_URL is required');
  });

  it('returns the trimmed database URL without logging it', () => {
    process.env.DATABASE_URL = '  postgresql://app:secret@127.0.0.1:5432/eastern_delight_unit  ';

    expect(loadConfiguration()).toEqual({
      databaseUrl: 'postgresql://app:secret@127.0.0.1:5432/eastern_delight_unit',
    });
  });
});

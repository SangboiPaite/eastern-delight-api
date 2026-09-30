const MIN_SECRET_LENGTH = 32;
const DEFAULT_ACCESS_EXPIRES_IN = '15m';
const DEFAULT_REFRESH_EXPIRES_IN = '7d';

export type AppConfiguration = {
  databaseUrl: string;
  jwtAccessSecret: string;
  jwtAccessExpiresIn: string;
  refreshTokenSecret: string;
  refreshTokenExpiresIn: string;
  organizationSlug: string;
};

function requiredText(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} is required`);
  }
  return trimmed;
}

function requiredSecret(name: string, value: string | undefined): string {
  const secret = requiredText(name, value);
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} is invalid`);
  }
  return secret;
}

function expiresIn(
  name: string,
  value: string | undefined,
  developmentDefault: string,
): string {
  const trimmed = value?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} is required`);
  }
  return developmentDefault;
}

export function loadConfiguration(): AppConfiguration {
  const databaseUrl = requiredText('DATABASE_URL', process.env.DATABASE_URL);
  const jwtAccessSecret = requiredSecret(
    'JWT_ACCESS_SECRET',
    process.env.JWT_ACCESS_SECRET,
  );
  const refreshTokenSecret = requiredSecret(
    'REFRESH_TOKEN_SECRET',
    process.env.REFRESH_TOKEN_SECRET,
  );

  if (jwtAccessSecret === refreshTokenSecret) {
    throw new Error('REFRESH_TOKEN_SECRET must differ from JWT_ACCESS_SECRET');
  }

  return {
    databaseUrl,
    jwtAccessSecret,
    jwtAccessExpiresIn: expiresIn(
      'JWT_ACCESS_EXPIRES_IN',
      process.env.JWT_ACCESS_EXPIRES_IN,
      DEFAULT_ACCESS_EXPIRES_IN,
    ),
    refreshTokenSecret,
    refreshTokenExpiresIn: expiresIn(
      'REFRESH_TOKEN_EXPIRES_IN',
      process.env.REFRESH_TOKEN_EXPIRES_IN,
      DEFAULT_REFRESH_EXPIRES_IN,
    ),
    organizationSlug: requiredText(
      'EASTERN_DELIGHT_ORGANIZATION_SLUG',
      process.env.EASTERN_DELIGHT_ORGANIZATION_SLUG,
    ),
  };
}

export default loadConfiguration;

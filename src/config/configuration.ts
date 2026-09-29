export type AppConfiguration = {
  databaseUrl: string;
};

export function loadConfiguration(): AppConfiguration {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  return { databaseUrl };
}

export default loadConfiguration;

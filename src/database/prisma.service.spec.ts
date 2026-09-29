import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaService } from './prisma.service.js';

const connect = vi.fn();
const disconnect = vi.fn();
const end = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool(this: { end: typeof end }) {
    this.end = end;
  }),
}));

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: vi.fn(),
}));

vi.mock('../../generated/prisma/client.js', () => ({
  PrismaClient: class PrismaClient {
    $connect = connect;
    $disconnect = disconnect;
  },
}));

describe('PrismaService', () => {
  const databaseUrl = 'postgresql://app:secret@127.0.0.1:5432/eastern_delight_unit';

  beforeEach(() => {
    connect.mockReset().mockResolvedValue(undefined);
    disconnect.mockReset().mockResolvedValue(undefined);
    end.mockReset().mockResolvedValue(undefined);
    vi.mocked(Pool).mockClear();
    vi.mocked(PrismaPg).mockClear();
  });

  it('creates one pg pool and Prisma 7 adapter from configured DATABASE_URL', () => {
    const configService = {
      getOrThrow: vi.fn().mockReturnValue(databaseUrl),
    } as unknown as ConfigService;

    const service = new PrismaService(configService);

    expect(configService.getOrThrow).toHaveBeenCalledWith('databaseUrl');
    expect(Pool).toHaveBeenCalledTimes(1);
    expect(Pool).toHaveBeenCalledWith({ connectionString: databaseUrl });
    expect(PrismaPg).toHaveBeenCalledTimes(1);
    expect(PrismaPg).toHaveBeenCalledWith(expect.any(Object));
    expect(service).toBeInstanceOf(PrismaService);
  });

  it('connects on module init and disconnects the client and pool on destroy', async () => {
    const configService = {
      getOrThrow: vi.fn().mockReturnValue(databaseUrl),
    } as unknown as ConfigService;

    const service = new PrismaService(configService);

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });
});

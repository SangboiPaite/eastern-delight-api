import { DatabaseModule } from './database.module.js';
import { PrismaService } from './prisma.service.js';

describe('DatabaseModule', () => {
  it('provides and exports PrismaService for feature modules', () => {
    const providers = Reflect.getMetadata('providers', DatabaseModule) as unknown[];
    const exported = Reflect.getMetadata('exports', DatabaseModule) as unknown[];

    expect(providers).toContain(PrismaService);
    expect(exported).toContain(PrismaService);
  });
});

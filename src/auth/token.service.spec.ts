import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { TokenService } from './token.service.js';
import type { AccessTokenClaims } from './access-token.js';

const ACCESS_SECRET = 'test-access-secret-32-characters!';
const OTHER_SECRET = 'other-access-secret-32-characters';

const claims: AccessTokenClaims = {
  sub: '11111111-1111-4111-8111-111111111111',
  org: '22222222-2222-4222-8222-222222222222',
  role: 'ADMIN',
};

describe('TokenService', () => {
  let service: TokenService;

  async function createService(expiresIn = '15m'): Promise<TokenService> {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: ACCESS_SECRET,
          signOptions: { expiresIn },
        }),
      ],
      providers: [TokenService],
    }).compile();

    return module.get(TokenService);
  }

  beforeAll(async () => {
    service = await createService();
  }, 15000);

  it('signs and verifies a minimal access-token payload', async () => {
    const token = await service.signAccessToken(claims);
    const verified = await service.verifyAccessToken(token);

    expect(verified).toEqual(claims);
    expect(token.split('.')).toHaveLength(3);
    expect(JSON.stringify(verified)).not.toMatch(/passwordHash|refresh/i);
  });

  it('rejects a token signed with a different secret', async () => {
    const otherJwt = new JwtService({ secret: OTHER_SECRET });
    const token = await otherJwt.signAsync(claims);

    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const jwt = new JwtService({ secret: ACCESS_SECRET });
    const token = await jwt.signAsync(claims, { expiresIn: '1ms' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a verified token missing required claims', async () => {
    const jwt = new JwtService({ secret: ACCESS_SECRET });
    const token = await jwt.signAsync({ sub: claims.sub, org: claims.org });

    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

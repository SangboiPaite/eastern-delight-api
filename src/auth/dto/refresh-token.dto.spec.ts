import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { RefreshTokenDto } from './refresh-token.dto.js';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: RefreshTokenDto,
};

describe('RefreshTokenDto', () => {
  it('keeps the refresh token exactly as supplied', async () => {
    const dto = (await pipe.transform(
      { refreshToken: '  spaced-token  ' },
      metadata,
    )) as RefreshTokenDto;

    expect(dto.refreshToken).toBe('  spaced-token  ');
  });

  it('rejects unknown fields', async () => {
    await expect(
      pipe.transform(
        { refreshToken: 'opaque-token', extra: true },
        metadata,
      ),
    ).rejects.toBeDefined();
  });

  const invalidBodies: Array<[string, unknown]> = [
    ['a missing refresh token', {}],
    ['an empty refresh token', { refreshToken: '' }],
    ['a null refresh token', { refreshToken: null }],
    ['a non-string refresh token', { refreshToken: 12345 }],
  ];

  it.each(invalidBodies)('rejects %s', async (_name, body) => {
    await expect(pipe.transform(body, metadata)).rejects.toBeDefined();
  });
});

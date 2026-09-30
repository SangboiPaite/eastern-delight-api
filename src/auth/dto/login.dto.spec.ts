import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { LoginDto } from './login.dto.js';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: LoginDto,
};

describe('LoginDto', () => {
  it('trims mobile and organizationSlug but not password', async () => {
    const dto = (await pipe.transform(
      {
        mobile: '  9876543210  ',
        password: '  secret  ',
        organizationSlug: '  eastern-delight  ',
      },
      metadata,
    )) as LoginDto;

    expect(dto.mobile).toBe('9876543210');
    expect(dto.organizationSlug).toBe('eastern-delight');
    expect(dto.password).toBe('  secret  ');
  });

  it('rejects unknown fields', async () => {
    await expect(
      pipe.transform(
        {
          mobile: '9876543210',
          password: 'secret',
          organizationSlug: 'eastern-delight',
          extra: true,
        },
        metadata,
      ),
    ).rejects.toBeDefined();
  });

  it('rejects empty required strings', async () => {
    await expect(
      pipe.transform(
        { mobile: '', password: 'secret', organizationSlug: 'eastern-delight' },
        metadata,
      ),
    ).rejects.toBeDefined();
  });
});

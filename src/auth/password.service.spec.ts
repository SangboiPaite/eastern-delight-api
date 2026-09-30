import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();
  const password = 'correct-horse-battery';

  it('hashes asynchronously to a value different from plaintext', async () => {
    const hash = await service.hash(password);

    expect(hash).not.toBe(password);
    expect(hash.startsWith('$argon2')).toBe(true);
  });

  it('verifies the correct password', async () => {
    const hash = await service.hash(password);

    await expect(service.verify(hash, password)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash(password);

    await expect(service.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('rejects empty or invalid input without hashing it', async () => {
    await expect(service.hash('')).rejects.toThrowError('Password is required');
    await expect(service.verify('  ', password)).rejects.toThrowError(
      'Password hash is required',
    );
    await expect(service.verify('$argon2id$placeholder', '')).rejects.toThrowError(
      'Password is required',
    );
  });
});

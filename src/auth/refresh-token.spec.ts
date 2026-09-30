import { generateRefreshToken, hashRefreshToken } from './refresh-token.js';

describe('refresh token helpers', () => {
  it('generates opaque tokens and stores only a SHA-256 hash', () => {
    const token = generateRefreshToken();
    const digest = hashRefreshToken(token);

    expect(token).not.toBe(digest);
    expect(digest).toBe(hashRefreshToken(token));
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(generateRefreshToken()).not.toBe(token);
  });
});

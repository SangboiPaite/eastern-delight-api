import { durationToMilliseconds, expiryFromDuration } from './duration.js';

describe('duration', () => {
  it('parses the configured refresh and access TTLs', () => {
    expect(durationToMilliseconds('15m')).toBe(15 * 60 * 1000);
    expect(durationToMilliseconds('7d')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('computes an expiry timestamp from now', () => {
    const from = new Date('2026-10-01T00:00:00.000Z');
    expect(expiryFromDuration('1h', from).toISOString()).toBe(
      '2026-10-01T01:00:00.000Z',
    );
  });
});

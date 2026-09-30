import { normalizeMobile } from './normalize-mobile.js';

describe('normalizeMobile', () => {
  it('trims whitespace without adding a country code', () => {
    expect(normalizeMobile('  9876543210  ')).toBe('9876543210');
    expect(normalizeMobile('09876543210')).toBe('09876543210');
  });
});

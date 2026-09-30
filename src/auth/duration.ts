const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function durationToMilliseconds(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/i.exec(value.trim());
  if (!match) {
    throw new Error('Token expiry is invalid');
  }
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  return amount * UNIT_MS[unit];
}

export function expiryFromDuration(value: string, from = new Date()): Date {
  return new Date(from.getTime() + durationToMilliseconds(value));
}

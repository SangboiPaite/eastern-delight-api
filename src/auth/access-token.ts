export const ACCESS_TOKEN_ROLES = ['ADMIN', 'STAFF'] as const;

export type AccessTokenRole = (typeof ACCESS_TOKEN_ROLES)[number];

export type AccessTokenClaims = {
  sub: string;
  org: string;
  role: AccessTokenRole;
};

export function isAccessTokenRole(value: unknown): value is AccessTokenRole {
  return value === 'ADMIN' || value === 'STAFF';
}

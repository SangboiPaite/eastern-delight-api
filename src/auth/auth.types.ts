export const INVALID_CREDENTIALS = 'Invalid credentials.';

export type AuthAppRole = 'admin' | 'staff';

export type AuthUserResponse = {
  id: string;
  organizationId: string;
  role: AuthAppRole;
  name: string;
};

export type AuthTokenResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: AuthUserResponse;
};

export function toAuthAppRole(role: 'ADMIN' | 'STAFF'): AuthAppRole {
  return role === 'ADMIN' ? 'admin' : 'staff';
}

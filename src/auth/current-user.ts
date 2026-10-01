import type { AccessTokenRole } from './access-token.js';

export type CurrentUserContext = {
  id: string;
  organizationId: string;
  role: AccessTokenRole;
};

export type AccessTokenRequest = {
  headers: {
    authorization?: unknown;
  };
  user?: CurrentUserContext;
};

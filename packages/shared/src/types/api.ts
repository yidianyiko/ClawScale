export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
  code?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Auth ──────────────────────────────────────────────────────────────────────

export interface RegisterPayload {
  /** Workspace slug (URL-safe, e.g. "acme-corp") */
  tenantSlug: string;
  /** Workspace display name */
  tenantName: string;
  /** Admin user name */
  name: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  expiresAt: string;
}

export interface AuthResult {
  tokens: AuthTokens;
  user: import('./user.js').PublicUser;
  tenant: import('./tenant.js').Tenant;
}

export type UserRole = 'admin' | 'member' | 'viewer';

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  lastActiveAt: string | null;
}

/** Safe user object (no password hash) returned from API */
export type PublicUser = User;

export interface InviteUserPayload {
  email: string;
  name: string;
  role: UserRole;
}

export interface UpdateUserPayload {
  name?: string;
  role?: UserRole;
}

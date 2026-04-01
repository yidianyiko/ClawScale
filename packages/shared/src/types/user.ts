export type MemberRole = 'admin' | 'member' | 'viewer';
export type UserRole = MemberRole;

/** Internal staff member who manages the bot via the dashboard */
export interface Member {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: MemberRole;
  isActive: boolean;
  createdAt: string;
  lastActiveAt: string | null;
}

/** Alias used by auth result (kept as `user` in the API response shape for front-end compat) */
export type PublicUser = Member;

export interface InviteMemberPayload {
  email: string;
  name: string;
  role: MemberRole;
  temporaryPassword: string;
}

export interface UpdateMemberPayload {
  name?: string;
  role?: MemberRole;
  isActive?: boolean;
}

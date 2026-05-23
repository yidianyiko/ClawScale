export interface PublicUserLinkResponse {
  code: string;
  status: 'active';
  profile: {
    displayName: string;
    tagline: string | null;
    avatarUrl: string | null;
  };
}

export interface PublicLinkSessionResponse {
  token: string;
  targetAccountId: string;
  expiresAt: string;
  loginUrl: string;
  registerUrl: string;
}

export interface FriendRequestResponse {
  id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
}

export interface SharedReminderResponse {
  id: string;
  status: 'pending_invitee_confirmation' | 'accepted' | 'rejected' | 'cancelled' | 'expired' | 'invalidated';
  durationMinutes?: number | null;
}

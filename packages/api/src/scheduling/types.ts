export type UserLinkStatus = 'active' | 'disabled';
export type LinkSessionStatus = 'opened' | 'claimed' | 'abandoned';
export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';
export type FriendshipStatus = 'active' | 'removed';
export type SharedReminderRequestStatus =
  | 'pending_invitee_confirmation'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'invalidated';
export type SharedReminderProjectionRole = 'requester' | 'invitee';

export interface SchedulingErrorBody {
  ok: false;
  error:
    | 'invalid_body'
    | 'invalid_user_link'
    | 'invalid_link_session'
    | 'link_session_expired'
    | 'cannot_friend_self'
    | 'friend_request_blocked'
    | 'friend_request_not_found'
    | 'friendship_required'
    | 'friendship_not_found'
    | 'shared_reminder_not_found'
    | 'shared_reminder_not_pending'
    | 'shared_reminder_due'
    | 'reminder_projection_failed'
    | 'bridge_delivery_failed'
    | 'not_allowed';
}

export interface WeeklyBookableWindowRule {
  type: 'weekly';
  days_of_week: number[];
  time_start: string;
  time_end: string;
  timezone: string;
  effective_from: string;
  effective_until: string | null;
}

export interface OnceBookableWindowRule {
  type: 'once';
  date: string;
  time_start: string;
  time_end: string;
  timezone: string;
}

export type BookableWindowRule = WeeklyBookableWindowRule | OnceBookableWindowRule;

export interface GeneratedWindowInstance {
  windowInstanceId: string;
  bookableWindowId: string;
  instanceStart: string;
  instanceEnd: string;
  providerTimezone: string;
}

export type SharedReminderRequestStatus =
  | 'pending_invitee_confirmation'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'invalidated';
export type SharedReminderProjectionRole = 'requester' | 'invitee';

export interface FriendCalendarBusyInterval {
  start_at: string;
  end_at: string;
  local_start: string;
  local_end: string;
}

interface FriendCalendarPrivacy {
  event_details_included: false;
}

interface FriendCalendarFactsSuccess {
  target_account_id: string;
  range: {
    from: string;
    to: string;
    timezone: string;
  };
  busy_intervals: FriendCalendarBusyInterval[];
  privacy: FriendCalendarPrivacy;
}

interface FriendCalendarFactsFriendshipRequired {
  status: 'friendship_required';
  target_account_id: string;
  busy_intervals: [];
  privacy: FriendCalendarPrivacy;
}

export type FriendCalendarFactsResult =
  | FriendCalendarFactsSuccess
  | FriendCalendarFactsFriendshipRequired;

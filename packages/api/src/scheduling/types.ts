export type SharedReminderRequestStatus =
  | 'pending_invitee_confirmation'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'invalidated';
export type SharedReminderProjectionRole = 'requester' | 'invitee';

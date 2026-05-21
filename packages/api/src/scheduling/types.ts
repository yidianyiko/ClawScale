export type SchedulingCapability = 'appointment_request';
export type UserLinkStatus = 'active' | 'disabled';
export type LinkSessionStatus = 'opened' | 'claimed' | 'abandoned';
export type ServiceLinkStatus = 'active' | 'blocked' | 'removed';
export type BookableWindowStatus = 'active' | 'closed';
export type AppointmentRequestStatus = 'pending_held' | 'confirmed_shared' | 'released';
export type AppointmentReleaseReason = 'rejected_by_a' | 'cancelled_by_a' | 'cancelled_by_b';
export type AppointmentActorRole = 'provider' | 'consumer' | 'system';

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

export interface SchedulingErrorBody {
  ok: false;
  error:
    | 'invalid_body'
    | 'invalid_timezone'
    | 'window_too_short'
    | 'window_overlap'
    | 'service_link_required'
    | 'service_link_blocked'
    | 'slot_unavailable'
    | 'appointment_not_found'
    | 'not_allowed'
    | 'cooldown_active'
    | 'bridge_delivery_failed';
}

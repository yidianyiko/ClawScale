import type { ApiResponse } from '../../shared/src/types/api';
import { customerApi } from './customer-api';

export interface CustomerFriendLink {
  code: string;
  status: 'active';
  url: string;
  qrUrl: string;
  profile: {
    displayName: string;
    tagline: string | null;
    avatarUrl: string | null;
  };
}

export interface CustomerFriendRequest {
  id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  direction: 'incoming' | 'outgoing';
  counterpartAccountId: string;
}

export interface CustomerFriend {
  id: string;
  status: string;
  counterpartAccountId: string;
  counterpartProfile?: {
    displayName: string;
    avatarUrl: string | null;
  };
}

type FriendRequestActionResult = {
  id: string;
  status: string;
};

export function getCustomerFriendLink(): Promise<ApiResponse<CustomerFriendLink>> {
  return customerApi.get<ApiResponse<CustomerFriendLink>>('/api/customer/scheduling/user-link');
}

export function resetCustomerFriendLink(): Promise<ApiResponse<CustomerFriendLink>> {
  return customerApi.post<ApiResponse<CustomerFriendLink>>('/api/customer/scheduling/user-link/reset');
}

export function disableCustomerFriendLink(): Promise<ApiResponse<{ count: number }>> {
  return customerApi.post<ApiResponse<{ count: number }>>('/api/customer/scheduling/user-link/disable');
}

export function listCustomerFriendRequests(): Promise<ApiResponse<CustomerFriendRequest[]>> {
  return customerApi.get<ApiResponse<CustomerFriendRequest[]>>('/api/customer/scheduling/friend-requests');
}

export function acceptCustomerFriendRequest(requestId: string): Promise<ApiResponse<FriendRequestActionResult>> {
  return customerApi.post<ApiResponse<FriendRequestActionResult>>(
    `/api/customer/scheduling/friend-requests/${encodeURIComponent(requestId)}/accept`,
  );
}

export function rejectCustomerFriendRequest(requestId: string): Promise<ApiResponse<FriendRequestActionResult>> {
  return customerApi.post<ApiResponse<FriendRequestActionResult>>(
    `/api/customer/scheduling/friend-requests/${encodeURIComponent(requestId)}/reject`,
  );
}

export function cancelCustomerFriendRequest(requestId: string): Promise<ApiResponse<FriendRequestActionResult>> {
  return customerApi.post<ApiResponse<FriendRequestActionResult>>(
    `/api/customer/scheduling/friend-requests/${encodeURIComponent(requestId)}/cancel`,
  );
}

export function listCustomerFriends(): Promise<ApiResponse<CustomerFriend[]>> {
  return customerApi.get<ApiResponse<CustomerFriend[]>>('/api/customer/scheduling/friends');
}

export function removeCustomerFriend(friendshipId: string): Promise<ApiResponse<FriendRequestActionResult>> {
  return customerApi.delete<ApiResponse<FriendRequestActionResult>>(
    `/api/customer/scheduling/friends/${encodeURIComponent(friendshipId)}`,
  );
}

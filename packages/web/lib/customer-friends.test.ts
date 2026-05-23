import { afterEach, describe, expect, it, vi } from 'vitest';
import { customerApi } from './customer-api';
import {
  acceptCustomerFriendRequest,
  cancelCustomerFriendRequest,
  disableCustomerFriendLink,
  getCustomerFriendLink,
  listCustomerFriendRequests,
  listCustomerFriends,
  rejectCustomerFriendRequest,
  removeCustomerFriend,
  resetCustomerFriendLink,
} from './customer-friends';

vi.mock('./customer-api', () => ({
  customerApi: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const apiMock = vi.mocked(customerApi);

afterEach(() => {
  vi.clearAllMocks();
});

describe('customer friends wrappers', () => {
  it('reads the current friend link, friend requests, and friends from scheduling endpoints', async () => {
    apiMock.get.mockResolvedValue({ ok: true, data: null });

    await getCustomerFriendLink();
    await listCustomerFriendRequests();
    await listCustomerFriends();

    expect(apiMock.get).toHaveBeenNthCalledWith(1, '/api/customer/scheduling/user-link');
    expect(apiMock.get).toHaveBeenNthCalledWith(2, '/api/customer/scheduling/friend-requests');
    expect(apiMock.get).toHaveBeenNthCalledWith(3, '/api/customer/scheduling/friends');
  });

  it('mutates the current friend link through reset and disable endpoints', async () => {
    apiMock.post.mockResolvedValue({ ok: true, data: null });

    await resetCustomerFriendLink();
    await disableCustomerFriendLink();

    expect(apiMock.post).toHaveBeenNthCalledWith(1, '/api/customer/scheduling/user-link/reset');
    expect(apiMock.post).toHaveBeenNthCalledWith(2, '/api/customer/scheduling/user-link/disable');
  });

  it('runs friend request actions with encoded request ids', async () => {
    apiMock.post.mockResolvedValue({ ok: true, data: { id: 'fr/1', status: 'pending' } });

    await acceptCustomerFriendRequest('fr/1');
    await rejectCustomerFriendRequest('fr/1');
    await cancelCustomerFriendRequest('fr/1');

    expect(apiMock.post).toHaveBeenNthCalledWith(1, '/api/customer/scheduling/friend-requests/fr%2F1/accept');
    expect(apiMock.post).toHaveBeenNthCalledWith(2, '/api/customer/scheduling/friend-requests/fr%2F1/reject');
    expect(apiMock.post).toHaveBeenNthCalledWith(3, '/api/customer/scheduling/friend-requests/fr%2F1/cancel');
  });

  it('removes a friendship with an encoded friendship id', async () => {
    apiMock.delete.mockResolvedValueOnce({ ok: true, data: { id: 'fs/1', status: 'removed' } });

    await removeCustomerFriend('fs/1');

    expect(apiMock.delete).toHaveBeenCalledWith('/api/customer/scheduling/friends/fs%2F1');
  });
});

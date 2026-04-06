import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCokeUserAuth,
  getCokeUser,
  getCokeUserToken,
  storeCokeUserAuth,
} from './coke-user-auth';

describe('coke user auth storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores coke user auth under separate keys', () => {
    storeCokeUserAuth({
      token: 'user-token',
      user: {
        id: 'user_1',
        email: 'alice@example.com',
        display_name: 'Alice',
      },
    });

    expect(getCokeUserToken()).toBe('user-token');
    expect(getCokeUser()?.email).toBe('alice@example.com');

    clearCokeUserAuth();
    expect(getCokeUserToken()).toBeNull();
    expect(getCokeUser()).toBeNull();
  });
});

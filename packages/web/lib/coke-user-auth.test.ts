import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCokeUserAuth,
  getCokeUser,
  getCokeUserToken,
  storeCokeUserAuth,
} from './coke-user-auth';
import {
  clearCustomerAuth,
  getCustomerSession,
  getCustomerToken,
  getStoredCustomerSession,
  loginCustomer,
  registerCustomer,
  requestCustomerPasswordReset,
  resendCustomerVerification,
  resetCustomerPassword,
  storeCustomerAuth,
  verifyCustomerEmail,
} from './customer-auth';

describe('coke user auth storage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
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

  it('stays on the legacy coke storage contract and does not read neutral customer session keys', () => {
    storeCustomerAuth({
      token: 'customer-token',
      customerId: 'ck_1',
      identityId: 'idt_1',
      email: 'alice@example.com',
      claimStatus: 'active',
      membershipRole: 'owner',
    });

    expect(getCokeUserToken()).toBeNull();
    expect(getCokeUser()).toBeNull();
  });

  it('does not expose split-brain auth route wrappers from the legacy coke auth module', async () => {
    const cokeUserAuthModule = await import('./coke-user-auth');

    expect(cokeUserAuthModule).not.toHaveProperty('registerCokeUser');
    expect(cokeUserAuthModule).not.toHaveProperty('loginCokeUser');
    expect(cokeUserAuthModule).not.toHaveProperty('verifyCokeUserEmail');
    expect(cokeUserAuthModule).not.toHaveProperty('resendCokeUserVerification');
    expect(cokeUserAuthModule).not.toHaveProperty('requestCokeUserPasswordReset');
    expect(cokeUserAuthModule).not.toHaveProperty('resetCokeUserPassword');
    expect(cokeUserAuthModule).not.toHaveProperty('getCokeUserSession');
    expect(cokeUserAuthModule).not.toHaveProperty('fetchCokeUserSession');
  });
});

describe('customer auth storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores the neutral customer auth session under customer-scoped keys', () => {
    storeCustomerAuth({
      token: 'customer-token',
      customerId: 'ck_1',
      identityId: 'idt_1',
      email: 'alice@example.com',
      claimStatus: 'active',
      membershipRole: 'owner',
    });

    expect(getCustomerToken()).toBe('customer-token');
    expect(getStoredCustomerSession()).toEqual({
      customerId: 'ck_1',
      identityId: 'idt_1',
      email: 'alice@example.com',
      claimStatus: 'active',
      membershipRole: 'owner',
    });

    clearCustomerAuth();
    expect(getCustomerToken()).toBeNull();
    expect(getStoredCustomerSession()).toBeNull();
  });
});

describe('customer auth api helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the neutral /api/auth lifecycle endpoints', async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, data: { token: 'customer-token' } });
    const get = vi.fn().mockResolvedValue({ ok: true, data: { customerId: 'ck_1' } });
    const customerApiModule = await import('./customer-api');

    vi.spyOn(customerApiModule.customerApi, 'post').mockImplementation(post);
    vi.spyOn(customerApiModule.customerApi, 'get').mockImplementation(get);

    await registerCustomer({ displayName: 'Alice', email: 'alice@example.com', password: 'password123' });
    await loginCustomer({ email: 'alice@example.com', password: 'password123' });
    await verifyCustomerEmail({ email: 'alice@example.com', token: 'verify-token' });
    await resendCustomerVerification({ email: 'alice@example.com' });
    await requestCustomerPasswordReset({ email: 'alice@example.com' });
    await resetCustomerPassword({ token: 'reset-token', password: 'password123' });
    await getCustomerSession();

    expect(post).toHaveBeenNthCalledWith(1, '/api/auth/register', {
      displayName: 'Alice',
      email: 'alice@example.com',
      password: 'password123',
    });
    expect(post).toHaveBeenNthCalledWith(2, '/api/auth/login', {
      email: 'alice@example.com',
      password: 'password123',
    });
    expect(post).toHaveBeenNthCalledWith(3, '/api/auth/verify-email', {
      email: 'alice@example.com',
      token: 'verify-token',
    });
    expect(post).toHaveBeenNthCalledWith(4, '/api/auth/resend-verification', {
      email: 'alice@example.com',
    });
    expect(post).toHaveBeenNthCalledWith(5, '/api/auth/forgot-password', {
      email: 'alice@example.com',
    });
    expect(post).toHaveBeenNthCalledWith(6, '/api/auth/reset-password', {
      token: 'reset-token',
      password: 'password123',
    });
    expect(get).toHaveBeenCalledWith('/api/auth/me');
  });
});

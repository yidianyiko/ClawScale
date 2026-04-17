import type { ApiResponse } from '../../shared/src/types/api';
import { customerApi } from './customer-api';

const TOKEN_KEY = 'customer_token';
const SESSION_KEY = 'customer_session';

export type CustomerClaimStatus = 'active' | 'unclaimed' | 'pending';
export type CustomerMembershipRole = 'owner' | 'member' | 'viewer';

export interface CustomerSession {
  customerId: string;
  identityId: string;
  claimStatus: CustomerClaimStatus;
  email: string;
  membershipRole: CustomerMembershipRole;
}

export interface CustomerAuthResult extends CustomerSession {
  token: string;
}

export interface CustomerAuthMessageResult {
  message: string;
}

export interface RegisterCustomerInput {
  displayName: string;
  email: string;
  password: string;
}

export interface LoginCustomerInput {
  email: string;
  password: string;
}

export interface VerifyCustomerEmailInput {
  email: string;
  token: string;
}

export interface CustomerEmailInput {
  email: string;
}

export interface ResetCustomerPasswordInput {
  token: string;
  password: string;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function storeCustomerAuth(result: CustomerAuthResult): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const { token, ...session } = result;
  storage.setItem(TOKEN_KEY, token);
  storage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearCustomerAuth(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.removeItem(TOKEN_KEY);
  storage.removeItem(SESSION_KEY);
}

export function getCustomerToken(): string | null {
  return getStorage()?.getItem(TOKEN_KEY) ?? null;
}

export function getStoredCustomerSession(): CustomerSession | null {
  const raw = getStorage()?.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as CustomerSession;
  } catch {
    return null;
  }
}

export function registerCustomer(
  input: RegisterCustomerInput,
): Promise<ApiResponse<CustomerAuthResult>> {
  return customerApi.post<ApiResponse<CustomerAuthResult>>('/api/auth/register', input);
}

export function loginCustomer(
  input: LoginCustomerInput,
): Promise<ApiResponse<CustomerAuthResult>> {
  return customerApi.post<ApiResponse<CustomerAuthResult>>('/api/auth/login', input);
}

export function verifyCustomerEmail(
  input: VerifyCustomerEmailInput,
): Promise<ApiResponse<CustomerAuthResult>> {
  return customerApi.post<ApiResponse<CustomerAuthResult>>('/api/auth/verify-email', input);
}

export function resendCustomerVerification(
  input: CustomerEmailInput,
): Promise<ApiResponse<CustomerAuthMessageResult>> {
  return customerApi.post<ApiResponse<CustomerAuthMessageResult>>('/api/auth/resend-verification', input);
}

export function requestCustomerPasswordReset(
  input: CustomerEmailInput,
): Promise<ApiResponse<CustomerAuthMessageResult>> {
  return customerApi.post<ApiResponse<CustomerAuthMessageResult>>('/api/auth/forgot-password', input);
}

export function resetCustomerPassword(
  input: ResetCustomerPasswordInput,
): Promise<ApiResponse<CustomerAuthMessageResult>> {
  return customerApi.post<ApiResponse<CustomerAuthMessageResult>>('/api/auth/reset-password', input);
}

export function getCustomerSession(): Promise<ApiResponse<CustomerSession>> {
  return customerApi.get<ApiResponse<CustomerSession>>('/api/auth/me');
}

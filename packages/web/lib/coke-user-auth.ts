import {
  getStoredCustomerSession,
  getCustomerSession,
  loginCustomer,
  registerCustomer,
  requestCustomerPasswordReset,
  resendCustomerVerification,
  resetCustomerPassword,
  verifyCustomerEmail,
  type CustomerAuthMessageResult,
  type CustomerAuthResult as NeutralCustomerAuthResult,
  type CustomerEmailInput,
  type CustomerSession,
  type LoginCustomerInput,
  type RegisterCustomerInput,
  type ResetCustomerPasswordInput,
  type VerifyCustomerEmailInput,
} from './customer-auth';

const TOKEN_KEY = 'coke_user_token';
const USER_KEY = 'coke_user_profile';

export interface CokeUser {
  id: string;
  email: string;
  display_name: string;
  email_verified?: boolean;
  status?: 'normal' | 'suspended';
  subscription_active?: boolean;
  subscription_expires_at?: string | null;
}

export interface CokeAuthResult {
  token: string;
  user: CokeUser;
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

export function storeCokeUserAuth(result: CokeAuthResult): void {
  const storage = getStorage();
  if (!storage) return;

  storage.setItem(TOKEN_KEY, result.token);
  storage.setItem(USER_KEY, JSON.stringify(result.user));
}

export function clearCokeUserAuth(): void {
  const storage = getStorage();
  if (!storage) return;

  storage.removeItem(TOKEN_KEY);
  storage.removeItem(USER_KEY);
}

export function getCokeUserToken(): string | null {
  const storage = getStorage();
  return storage ? storage.getItem(TOKEN_KEY) : null;
}

export function getCokeUser(): CokeUser | null {
  const storage = getStorage();
  const raw = storage?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CokeUser;
  } catch {
    return null;
  }
}

export function isCokeUserSuspended(user: CokeUser | null): boolean {
  return user?.status === 'suspended';
}

export function needsCokeEmailVerification(user: CokeUser | null): boolean {
  return user?.email_verified !== true;
}

export function needsCokeSubscriptionRenewal(user: CokeUser | null): boolean {
  return user?.subscription_active !== true;
}

export type CokeUserSession = CustomerSession;
export type CokeUserAuthApiResult = NeutralCustomerAuthResult;
export type CokeUserAuthMessageResult = CustomerAuthMessageResult;
export type RegisterCokeUserInput = RegisterCustomerInput;
export type LoginCokeUserInput = LoginCustomerInput;
export type VerifyCokeUserEmailInput = VerifyCustomerEmailInput;
export type CokeUserEmailInput = CustomerEmailInput;
export type ResetCokeUserPasswordInput = ResetCustomerPasswordInput;

export function registerCokeUser(
  input: RegisterCokeUserInput,
): Promise<import('../../shared/src/types/api').ApiResponse<CokeUserAuthApiResult>> {
  return registerCustomer(input);
}

export function loginCokeUser(
  input: LoginCokeUserInput,
): Promise<import('../../shared/src/types/api').ApiResponse<CokeUserAuthApiResult>> {
  return loginCustomer(input);
}

export function verifyCokeUserEmail(
  input: VerifyCokeUserEmailInput,
): Promise<import('../../shared/src/types/api').ApiResponse<CokeUserAuthApiResult>> {
  return verifyCustomerEmail(input);
}

export function resendCokeUserVerification(
  input: CokeUserEmailInput,
): Promise<import('../../shared/src/types/api').ApiResponse<CokeUserAuthMessageResult>> {
  return resendCustomerVerification(input);
}

export function requestCokeUserPasswordReset(
  input: CokeUserEmailInput,
): Promise<import('../../shared/src/types/api').ApiResponse<CokeUserAuthMessageResult>> {
  return requestCustomerPasswordReset(input);
}

export function resetCokeUserPassword(
  input: ResetCokeUserPasswordInput,
): Promise<import('../../shared/src/types/api').ApiResponse<CokeUserAuthMessageResult>> {
  return resetCustomerPassword(input);
}

export function getCokeUserSession(): CokeUserSession | null {
  return getStoredCustomerSession();
}

export function fetchCokeUserSession(): Promise<
  import('../../shared/src/types/api').ApiResponse<CokeUserSession>
> {
  return getCustomerSession();
}

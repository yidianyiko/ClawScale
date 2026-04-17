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

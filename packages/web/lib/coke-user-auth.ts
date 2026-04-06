const TOKEN_KEY = 'coke_user_token';
const USER_KEY = 'coke_user_profile';

export interface CokeUser {
  id: string;
  email: string;
  display_name: string;
}

export interface CokeAuthResult {
  token: string;
  user: CokeUser;
}

export function storeCokeUserAuth(result: CokeAuthResult): void {
  localStorage.setItem(TOKEN_KEY, result.token);
  localStorage.setItem(USER_KEY, JSON.stringify(result.user));
}

export function clearCokeUserAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getCokeUserToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getCokeUser(): CokeUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CokeUser;
  } catch {
    return null;
  }
}

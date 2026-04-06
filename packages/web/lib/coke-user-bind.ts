export function shouldStartCokeBindSession(input: {
  isDesktop: boolean | null;
  hasToken: boolean | null;
}): boolean {
  return input.isDesktop === true && input.hasToken === true;
}

export function getCokeBindFailureKind(input: {
  code?: string;
  error?: string;
}): 'auth' | 'generic' {
  const code = input.code?.toLowerCase() ?? '';
  const error = input.error?.toLowerCase() ?? '';

  if (
    code.includes('auth') ||
    code.includes('token') ||
    code.includes('unauthorized') ||
    error.includes('unauthorized') ||
    error.includes('invalid or expired token') ||
    error.includes('expired token')
  ) {
    return 'auth';
  }

  return 'generic';
}

import { describe, expect, it } from 'vitest';
import { getCokeBindFailureKind, shouldStartCokeBindSession } from './coke-user-bind';

describe('shouldStartCokeBindSession', () => {
  it('does not start a bind session until desktop and auth are both confirmed', () => {
    expect(shouldStartCokeBindSession({ isDesktop: true, hasToken: null })).toBe(false);
    expect(shouldStartCokeBindSession({ isDesktop: null, hasToken: true })).toBe(false);
    expect(shouldStartCokeBindSession({ isDesktop: false, hasToken: true })).toBe(false);
    expect(shouldStartCokeBindSession({ isDesktop: true, hasToken: false })).toBe(false);
    expect(shouldStartCokeBindSession({ isDesktop: true, hasToken: true })).toBe(true);
  });

  it('classifies unauthorized and expired-token api failures as auth recovery cases', () => {
    expect(getCokeBindFailureKind({ error: 'Unauthorized' })).toBe('auth');
    expect(getCokeBindFailureKind({ error: 'Invalid or expired token' })).toBe('auth');
    expect(getCokeBindFailureKind({ error: 'Temporary bridge failure' })).toBe('generic');
  });
});

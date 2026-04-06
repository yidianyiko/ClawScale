export function shouldStartCokeBindSession(input: {
  isDesktop: boolean | null;
  hasToken: boolean | null;
}): boolean {
  return input.isDesktop === true && input.hasToken === true;
}

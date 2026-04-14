# Web Frontend Single-Language I18n Design

**Date:** 2026-04-14

## Goal

Convert the entire `gateway/packages/web` frontend from mixed-language and English-only copy into a two-locale experience that renders one language at a time, auto-selects language from the browser on first visit, and persists the user's manual choice across page loads and navigation.

## Scope

- Public homepage and public shell
- Coke user account flow under `app/(coke-user)/coke/*`
- Dashboard shell and all dashboard pages under `app/dashboard/*`
- Shared UI copy in `components/*` and route-local helpers that expose user-facing labels
- Existing web tests that currently assert fixed English strings

Out of scope:

- Backend/API response localization
- URL-based locale routing such as `/en/...`
- Adding languages beyond `zh` and `en`

## Product Requirements

1. Only one language is visible at a time.
2. Supported locales are `zh` and `en`.
3. First visit language is chosen from the browser language.
4. User language choice persists for later visits and cross-page navigation.
5. A visible language switcher is available across the web frontend.
6. Existing page structure and routes stay unchanged.

## Architecture

The frontend will use a lightweight in-app i18n layer instead of a routing-based or third-party i18n framework. A shared locale module will define supported locales, locale detection, storage/cookie keys, and the translation message catalog. A client `LocaleProvider` will expose the active locale, translated messages, and a `setLocale` action via React context.

To reduce first-render language mismatch, locale selection will be server-seeded and client-persisted:

- On the server, the root layout reads a locale cookie first, then falls back to `Accept-Language`.
- On the client, manual switching updates both the cookie and `localStorage`.
- During hydration, the provider initializes from the server locale and keeps `document.documentElement.lang` in sync.

This keeps the first render aligned with browser language or saved preference while still allowing fast client-side switching.

## File Structure

### New files

- `packages/web/lib/i18n.ts`
  Central locale types, supported locale constants, storage/cookie keys, locale detection helpers, and the full message catalog.
- `packages/web/components/locale-provider.tsx`
  React context provider and hook for locale state and translated message access.
- `packages/web/components/locale-switch.tsx`
  Shared toggle UI rendered in the public shell, Coke account shell, and dashboard shell.

### Existing files to modify

- `packages/web/app/layout.tsx`
  Seed the initial locale from headers/cookies and mount the locale provider.
- `packages/web/components/coke-public-shell.tsx`
  Render translated header copy and language switcher.
- `packages/web/components/coke-homepage.tsx`
  Replace mixed-language copy with message-driven single-language content.
- `packages/web/app/(coke-user)/coke/layout.tsx`
  Render translated shell copy and language switcher.
- `packages/web/app/(coke-user)/coke/*.tsx`
  Replace hard-coded page strings with locale-driven messages.
- `packages/web/app/dashboard/layout.tsx`
  Render translated nav, button text, and language switcher.
- `packages/web/app/dashboard/*.tsx`
  Replace page copy with locale-driven messages.
- `packages/web/app/**/channel-options.ts`
  Translate shared option labels if surfaced to users.
- `packages/web/app/**/*.test.*`
  Update assertions and add regression coverage for locale behavior.

## Message Model

Messages will live in a typed object with parallel `en` and `zh` branches. The provider will expose the active locale's branch as a strongly typed `messages` object. Components will read from `messages` directly instead of performing string-key lookups at runtime. This avoids brittle path strings and fits the existing codebase, which already favors plain object access over framework abstractions.

The catalog will be grouped by UI area:

- `common`
- `publicShell`
- `homepage`
- `cokeUserLayout`
- `cokeUserPages`
- `dashboardLayout`
- `dashboardPages`

## UI Placement

The language switcher will be shown in each top-level shell:

- Public shell header
- Coke user layout header
- Dashboard sidebar/footer or top utility area

The control will be compact and explicit, showing `EN` and `中文`. The active locale will have a stronger visual treatment. Switching locale updates visible text immediately without a route change.

## Data Flow

1. Request hits `app/layout.tsx`.
2. Layout resolves `initialLocale` from cookie or `Accept-Language`.
3. Layout mounts `LocaleProvider` with `initialLocale`.
4. Client pages/components read `messages` from context.
5. User switches locale.
6. Provider updates React state, writes cookie + `localStorage`, and updates `<html lang>`.
7. Navigation preserves locale through provider state; refreshes preserve locale through cookie/localStorage.

## Error Handling

- Unsupported or malformed locale values fall back to `en`.
- Missing cookie/localStorage values fall back to browser language.
- Missing translation branches should fail fast in development by using one typed message shape for both locales, so incomplete catalogs are caught at compile time.

## Testing Strategy

1. Unit-test locale helpers:
   - browser-language resolution
   - persisted-locale validation
   - cookie/localStorage fallback behavior
2. Component-test the provider/switcher:
   - default locale rendering
   - manual switching
   - persistence side effects
3. Update existing page tests to assert locale-driven content instead of fixed bilingual strings.
4. Add regression coverage for at least:
   - homepage rendering in English
   - homepage or shared shell rendering in Chinese
   - dashboard shell translated navigation
   - one Coke user page translated labels

## Risks and Mitigations

- Large copy surface across many pages:
  Keep all user-facing strings in one typed catalog so missing translations surface quickly.
- Hydration mismatch risk:
  Seed locale on the server from cookie/header rather than detecting only in `useEffect`.
- Test churn:
  Introduce small test helpers for rendering with a mocked locale provider so page tests stay readable.

## Rollout Notes

- No route or API changes are required.
- This can ship as a single frontend-only change set.
- Browser persistence will apply immediately after deploy without data migration.

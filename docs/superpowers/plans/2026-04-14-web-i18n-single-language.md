# Web Frontend Single-Language I18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight two-locale system for `gateway/packages/web` so the entire frontend renders one language at a time, auto-detects browser language, and persists user locale choice.

**Architecture:** Add a shared locale/message layer plus a client provider mounted from the root layout. Translate each shell/page to read from typed locale messages, expose a shared locale switcher, and verify behavior through focused helper tests plus updated page tests.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest, jsdom

---

### Task 1: Add Core Locale Infrastructure

**Files:**
- Create: `packages/web/lib/i18n.ts`
- Create: `packages/web/components/locale-provider.tsx`
- Create: `packages/web/components/locale-switch.tsx`
- Modify: `packages/web/app/layout.tsx`
- Test: `packages/web/lib/i18n.test.ts`
- Test: `packages/web/components/locale-provider.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  detectLocaleFromAcceptLanguage,
  detectLocaleFromNavigator,
  normalizeLocale,
} from './i18n';

describe('normalizeLocale', () => {
  it('accepts zh and en and falls back for unsupported values', () => {
    expect(normalizeLocale('zh')).toBe('zh');
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('ja')).toBe(DEFAULT_LOCALE);
  });
});

describe('browser locale detection', () => {
  it('maps zh-* languages to zh and everything else to en', () => {
    expect(detectLocaleFromNavigator('zh-CN')).toBe('zh');
    expect(detectLocaleFromNavigator('zh-TW')).toBe('zh');
    expect(detectLocaleFromNavigator('en-US')).toBe('en');
    expect(detectLocaleFromNavigator('ja-JP')).toBe('en');
  });

  it('uses Accept-Language when no persisted locale exists', () => {
    expect(detectLocaleFromAcceptLanguage('zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh');
    expect(detectLocaleFromAcceptLanguage('en-US,en;q=0.9')).toBe('en');
  });
});
```

```tsx
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { LocaleProvider, useLocale } from './locale-provider';

function Probe() {
  const { locale, setLocale, messages } = useLocale();
  return (
    <>
      <p data-testid="locale">{locale}</p>
      <p data-testid="label">{messages.common.languageLabel}</p>
      <button onClick={() => setLocale('zh')}>switch</button>
    </>
  );
}

it('updates locale state and persistence when switched', () => {
  localStorage.clear();
  document.cookie = '';
  const container = document.createElement('div');
  const root = createRoot(container);

  flushSync(() => {
    root.render(
      <LocaleProvider initialLocale="en">
        <Probe />
      </LocaleProvider>,
    );
  });

  expect(container.querySelector('[data-testid="locale"]')?.textContent).toBe('en');
  container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(container.querySelector('[data-testid="locale"]')?.textContent).toBe('zh');
  expect(localStorage.getItem('coke-locale')).toBe('zh');
  expect(document.cookie).toContain('coke-locale=zh');
  root.unmount();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @clawscale/web test -- i18n.test.ts locale-provider.test.tsx`
Expected: FAIL because locale helpers/provider do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export const SUPPORTED_LOCALES = ['en', 'zh'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'coke-locale';
export const LOCALE_COOKIE_NAME = 'coke-locale';

export function normalizeLocale(value: string | null | undefined): Locale {
  return value === 'zh' || value === 'en' ? value : DEFAULT_LOCALE;
}

export function detectLocaleFromNavigator(value: string | null | undefined): Locale {
  return value?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
```

```tsx
const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ initialLocale, children }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    document.cookie = `${LOCALE_COOKIE_NAME}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
  }, []);

  return <LocaleContext.Provider value={{ locale, setLocale, messages: messages[locale] }}>{children}</LocaleContext.Provider>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @clawscale/web test -- i18n.test.ts locale-provider.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/i18n.ts packages/web/lib/i18n.test.ts packages/web/components/locale-provider.tsx packages/web/components/locale-provider.test.tsx packages/web/components/locale-switch.tsx packages/web/app/layout.tsx
git commit -m "feat(web): add locale infrastructure"
```

### Task 2: Translate Shared Shells and Homepage

**Files:**
- Modify: `packages/web/components/coke-public-shell.tsx`
- Modify: `packages/web/components/coke-homepage.tsx`
- Modify: `packages/web/app/page.test.tsx`
- Test: `packages/web/components/coke-public-shell.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders public shell navigation in Chinese when locale is zh', () => {
  renderWithLocale(<CokePublicShell><div>body</div></CokePublicShell>, 'zh');
  expect(screen.getByText('平台')).toBeTruthy();
  expect(screen.getByText('注册')).toBeTruthy();
});

it('renders homepage hero in English when locale is en', () => {
  renderWithLocale(<HomePage />, 'en');
  expect(screen.getByText('An AI Partner That Grows With You')).toBeTruthy();
  expect(screen.queryByText('与您共同成长的 AI 助手')).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @clawscale/web test -- app/page.test.tsx coke-public-shell.test.tsx`
Expected: FAIL because shared/public components still contain hard-coded mixed copy.

- [ ] **Step 3: Write minimal implementation**

```tsx
const { messages } = useLocale();
const navItems = messages.publicShell.navItems;

<Link href="/coke/login">{messages.publicShell.signIn}</Link>
<Link href="/coke/register">{messages.publicShell.register}</Link>
```

```tsx
const { messages } = useLocale();
<h1>{messages.homepage.hero.title}</h1>
<p>{messages.homepage.hero.subtitle}</p>
<StatCard value="6+" label={messages.homepage.stats.platforms} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @clawscale/web test -- app/page.test.tsx coke-public-shell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/coke-public-shell.tsx packages/web/components/coke-homepage.tsx packages/web/app/page.test.tsx packages/web/components/coke-public-shell.test.tsx
git commit -m "feat(web): localize public shell and homepage"
```

### Task 3: Translate Coke User Layout and Account Pages

**Files:**
- Modify: `packages/web/app/(coke-user)/coke/layout.tsx`
- Modify: `packages/web/app/(coke-user)/coke/login/page.tsx`
- Modify: `packages/web/app/(coke-user)/coke/register/page.tsx`
- Modify: `packages/web/app/(coke-user)/coke/forgot-password/page.tsx`
- Modify: `packages/web/app/(coke-user)/coke/reset-password/page.tsx`
- Modify: `packages/web/app/(coke-user)/coke/verify-email/page.tsx`
- Modify: `packages/web/app/(coke-user)/coke/renew/page.tsx`
- Modify: `packages/web/app/(coke-user)/coke/payment-success/page.tsx`
- Modify: `packages/web/app/(coke-user)/coke/payment-cancel/page.tsx`
- Modify: `packages/web/app/(coke-user)/coke/bind-wechat/page.tsx`
- Modify: `packages/web/app/(coke-user)/coke/login/page.test.tsx`
- Modify: `packages/web/app/(coke-user)/coke/verify-email/page.test.tsx`
- Modify: `packages/web/app/(coke-user)/coke/renew/page.test.tsx`
- Modify: `packages/web/app/(coke-user)/coke/bind-wechat/page.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders the Coke login form labels in Chinese', () => {
  renderWithLocale(<CokeLoginPage />, 'zh');
  expect(screen.getByLabelText('邮箱')).toBeTruthy();
  expect(screen.getByRole('button', { name: '登录 Coke' })).toBeTruthy();
});

it('renders bind-wechat actions in English', () => {
  renderWithLocale(<BindWechatPage />, 'en');
  expect(screen.getByText('What you can do next')).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @clawscale/web test -- 'app/(coke-user)/coke/login/page.test.tsx' 'app/(coke-user)/coke/verify-email/page.test.tsx' 'app/(coke-user)/coke/renew/page.test.tsx' 'app/(coke-user)/coke/bind-wechat/page.test.tsx'`
Expected: FAIL because account pages still use fixed English or bilingual strings.

- [ ] **Step 3: Write minimal implementation**

```tsx
const { messages } = useLocale();

<label htmlFor="email">{messages.cokeUserPages.login.emailLabel}</label>
<button>{loading ? messages.cokeUserPages.login.loading : messages.cokeUserPages.login.submit}</button>
```

```tsx
const blockedAccessState = {
  title: messages.cokeUserPages.bindWechat.suspendedTitle,
  description: messages.cokeUserPages.bindWechat.suspendedDescription,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @clawscale/web test -- 'app/(coke-user)/coke/login/page.test.tsx' 'app/(coke-user)/coke/verify-email/page.test.tsx' 'app/(coke-user)/coke/renew/page.test.tsx' 'app/(coke-user)/coke/bind-wechat/page.test.tsx'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/'(coke-user)'/coke
git commit -m "feat(web): localize coke account flow"
```

### Task 4: Translate Dashboard Layout and Dashboard Pages

**Files:**
- Modify: `packages/web/app/dashboard/layout.tsx`
- Modify: `packages/web/app/dashboard/page.tsx`
- Modify: `packages/web/app/dashboard/login/page.tsx`
- Modify: `packages/web/app/dashboard/register/page.tsx`
- Modify: `packages/web/app/dashboard/onboard/page.tsx`
- Modify: `packages/web/app/dashboard/channels/page.tsx`
- Modify: `packages/web/app/dashboard/conversations/page.tsx`
- Modify: `packages/web/app/dashboard/ai-backends/page.tsx`
- Modify: `packages/web/app/dashboard/workflows/page.tsx`
- Modify: `packages/web/app/dashboard/end-users/page.tsx`
- Modify: `packages/web/app/dashboard/users/page.tsx`
- Modify: `packages/web/app/dashboard/settings/page.tsx`
- Modify: `packages/web/app/dashboard/layout.test.tsx`
- Modify: `packages/web/app/(dashboard)/channels/page.test.ts`
- Modify: `packages/web/app/dashboard/channels/channel-options.ts`
- Modify: `packages/web/app/(dashboard)/channels/channel-options.ts`

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders dashboard nav labels in Chinese', () => {
  renderWithLocale(<DashboardLayout><div /></DashboardLayout>, 'zh');
  expect(screen.getByText('会话')).toBeTruthy();
  expect(screen.getByText('设置')).toBeTruthy();
});

it('renders the dashboard landing content in English', () => {
  renderWithLocale(<Dashboard />, 'en');
  expect(screen.getByText("Here's an overview of your chatbot.")).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @clawscale/web test -- app/dashboard/layout.test.tsx app/'(dashboard)'/channels/page.test.ts`
Expected: FAIL because dashboard pages and nav still use fixed English labels.

- [ ] **Step 3: Write minimal implementation**

```tsx
const { messages } = useLocale();
const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: messages.dashboardLayout.nav.dashboard, exact: true },
];
```

```tsx
<h1>{messages.dashboardPages.home.welcome(tenant?.name)}</h1>
<p>{messages.dashboardPages.home.subtitle}</p>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @clawscale/web test -- app/dashboard/layout.test.tsx app/'(dashboard)'/channels/page.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/dashboard packages/web/app/'(dashboard)'/channels packages/web/app/dashboard/layout.test.tsx
git commit -m "feat(web): localize dashboard pages"
```

### Task 5: Full Verification and Cleanup

**Files:**
- Review: `packages/web/**/*`
- Review: `docs/superpowers/specs/2026-04-14-web-i18n-single-language-design.md`
- Review: `docs/superpowers/plans/2026-04-14-web-i18n-single-language.md`

- [ ] **Step 1: Run the focused web test suite**

Run: `pnpm --filter @clawscale/web test`
Expected: PASS with all web tests green.

- [ ] **Step 2: Run the web build**

Run: `pnpm --filter @clawscale/web build`
Expected: PASS with successful Next.js production build.

- [ ] **Step 3: Review requirements against the spec**

```md
- entire `packages/web` renders one locale at a time
- browser language selects first visit locale
- manual switch persists across reload and navigation
- public shell, coke account shell, and dashboard shell expose locale switch
- tests cover locale infrastructure plus representative translated pages
```

- [ ] **Step 4: Commit**

```bash
git add packages/web docs/superpowers/specs/2026-04-14-web-i18n-single-language-design.md docs/superpowers/plans/2026-04-14-web-i18n-single-language.md
git commit -m "feat(web): ship single-language locale switching"
```

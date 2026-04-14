'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  type Locale,
  getBootstrappedLocale,
  detectClientLocale,
  messages,
  normalizeLocale,
} from '../lib/i18n';

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  messages: (typeof messages)[Locale];
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function applyLocaleEffects(locale: Locale) {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.lang = locale;

  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage may be unavailable in private browsing or hardened browser modes.
  }

  try {
    document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Ignore cookie write failures and keep the in-memory locale state.
  }
}

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale | string;
}) {
  const providedLocale = initialLocale !== undefined ? normalizeLocale(initialLocale) : null;
  const [locale, setLocaleState] = useState<Locale | null>(providedLocale);

  useEffect(() => {
    const resolvedLocale = providedLocale ?? getBootstrappedLocale() ?? detectClientLocale();
    setLocaleState((currentLocale) => currentLocale ?? resolvedLocale);
    applyLocaleEffects(resolvedLocale);
    document.getElementById('locale-splash')?.remove();
  }, [providedLocale]);

  const setLocale = useCallback((next: Locale) => {
    const normalized = normalizeLocale(next);
    setLocaleState(normalized);
    applyLocaleEffects(normalized);
  }, []);
  const resolvedLocale = locale ?? DEFAULT_LOCALE;

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale: resolvedLocale,
      setLocale,
      messages: messages[resolvedLocale],
    }),
    [resolvedLocale, setLocale],
  );

  if (locale === null) {
    return null;
  }

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}

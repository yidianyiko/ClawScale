import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  detectClientLocale,
  detectLocaleFromAcceptLanguage,
  detectLocaleFromNavigator,
  getLocaleBootstrapScript,
  messages,
  normalizeLocale,
  resolveInitialLocale,
} from './i18n';

describe('i18n helpers', () => {
  it('normalizes supported locales and falls back to en for unsupported values', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('zh')).toBe('zh');
    expect(normalizeLocale('ZH-CN')).toBe('zh');
    expect(normalizeLocale('ja')).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  it('detects locale from navigator language with zh as the only non-en branch', () => {
    expect(detectLocaleFromNavigator('zh-CN')).toBe('zh');
    expect(detectLocaleFromNavigator('zh-TW')).toBe('zh');
    expect(detectLocaleFromNavigator('en-US')).toBe('en');
    expect(detectLocaleFromNavigator('ja-JP')).toBe('en');
    expect(detectLocaleFromNavigator(undefined)).toBe('en');
  });

  it('detects locale from Accept-Language using the first explicit zh entry', () => {
    expect(detectLocaleFromAcceptLanguage('zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh');
    expect(detectLocaleFromAcceptLanguage('en-US,en;q=0.9,zh;q=0.8')).toBe('en');
    expect(detectLocaleFromAcceptLanguage('en-US;q=0.1,zh-CN;q=0.9')).toBe('zh');
    expect(detectLocaleFromAcceptLanguage('fr-FR,zh;q=0.9')).toBe('zh');
    expect(detectLocaleFromAcceptLanguage('fr-FR,en;q=0.8')).toBe('en');
    expect(detectLocaleFromAcceptLanguage('')).toBe('en');
  });

  it('ignores corrupted persisted locales and falls through to cookie values', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'broken');
    document.cookie = 'coke-locale=zh; path=/';

    try {
      expect(detectClientLocale()).toBe('zh');
    } finally {
      localStorage.removeItem(LOCALE_STORAGE_KEY);
      document.cookie = 'coke-locale=; path=/; Max-Age=0';
    }
  });

  it('falls back to navigator language when storage access fails', () => {
    const originalGetItem = Storage.prototype.getItem;
    const navigatorPrototype = Object.getPrototypeOf(window.navigator);
    const originalLanguage = Object.getOwnPropertyDescriptor(navigatorPrototype, 'language');

    Object.defineProperty(navigatorPrototype, 'language', {
      configurable: true,
      get: () => 'zh-CN',
    });
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };

    try {
      expect(detectClientLocale()).toBe('zh');
    } finally {
      Storage.prototype.getItem = originalGetItem;
      if (originalLanguage) {
        Object.defineProperty(navigatorPrototype, 'language', originalLanguage);
      }
    }
  });

  it('prefers a cookie value before Accept-Language when resolving the initial locale', () => {
    expect(
      resolveInitialLocale({
        cookieLocale: 'zh',
        acceptLanguage: 'en-US,en;q=0.9',
      }),
    ).toBe('zh');

    expect(
      resolveInitialLocale({
        cookieLocale: 'fr',
        acceptLanguage: 'zh-CN,zh;q=0.9',
      }),
    ).toBe('zh');

    expect(
      resolveInitialLocale({
        cookieLocale: undefined,
        acceptLanguage: 'fr-FR,fr;q=0.9',
      }),
    ).toBe('en');
  });

  it('builds a beforeInteractive locale bootstrap script', () => {
    const script = getLocaleBootstrapScript();

    expect(script).toContain(LOCALE_STORAGE_KEY);
    expect(script).toContain(LOCALE_COOKIE_NAME);
    expect(script).toContain('document.documentElement.lang');
    expect(script).toContain('window[bootstrapKey]');
    expect(script).toContain('navigator.language');
  });

  it('exposes matching locale branches in the message catalog', () => {
    expect(messages.en.common.languageLabel).toBe('Language');
    expect(messages.zh.common.languageLabel).toBe('语言');
    expect(messages.en.publicShell.cta.signIn).toBeDefined();
    expect(messages.zh.publicShell.cta.signIn).toBeDefined();
    expect(messages.en.homepage.platforms.items.length).toBeGreaterThan(0);
    expect(messages.zh.homepage.platforms.items.length).toBeGreaterThan(0);
    expect(LOCALE_COOKIE_NAME).toBe(LOCALE_STORAGE_KEY);
  });
});

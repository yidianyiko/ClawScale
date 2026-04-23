'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { type Locale } from '../lib/i18n';
import { LocaleSwitch } from './locale-switch';
import { useLocale } from './locale-provider';

const CUSTOMER_NAV = {
  en: [
    { href: '/channels', label: 'Channels' },
    { href: '/channels/wechat-personal', label: 'WeChat' },
    { href: '/account/subscription', label: 'Renewal' },
    { href: '/account/calendar-import', label: 'Calendar' },
  ],
  zh: [
    { href: '/channels', label: '通道' },
    { href: '/channels/wechat-personal', label: '微信' },
    { href: '/account/subscription', label: '续费' },
    { href: '/account/calendar-import', label: '日历' },
  ],
} satisfies Record<Locale, ReadonlyArray<{ href: string; label: string }>>;

export function CustomerShell({ children }: { children: ReactNode }) {
  const { locale, messages } = useLocale();
  const copy = messages.customerLayout;
  const pathname = usePathname();
  const navItems = CUSTOMER_NAV[locale];

  return (
    <div className="coke-site customer-shell-page">
      <header className="customer-shell__header">
        <div className="customer-shell__header-inner">
          <div className="customer-shell__header-top">
            <Link href="/" className="brand" aria-label="Kap AI">
              <span className="brand__mark">kap</span>
              <span className="brand__dot" aria-hidden="true" />
            </Link>

            <p className="customer-shell__header-copy">{copy.brandTagline}</p>

            <div className="customer-shell__header-actions">
              <LocaleSwitch />
            </div>
          </div>

          <nav className="customer-shell__nav" aria-label={copy.navLabel}>
            {navItems.map((item) => {
              const isCurrent =
                pathname === item.href || (item.href !== '/channels' && pathname?.startsWith(`${item.href}/`));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="customer-shell__nav-link"
                  aria-current={isCurrent ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <p className="customer-shell__route-copy">{copy.navLabel}</p>
        </div>
      </header>

      <main className="customer-shell__main">
        <section className="customer-shell__grid">
          <aside className="customer-shell__hero">
            <p className="customer-shell__eyebrow">{copy.eyebrow}</p>
            <h1 className="customer-shell__title">{copy.title}</h1>
            <p className="customer-shell__body">{copy.body}</p>
            <p className="customer-shell__secondary">{copy.secondaryBody}</p>

            <div className="customer-shell__trust">
              {copy.trustLines.map((line) => (
                <div key={line} className="customer-shell__trust-chip">
                  {line}
                </div>
              ))}
            </div>
          </aside>

          <div className="customer-shell__content">{children}</div>
        </section>
      </main>
    </div>
  );
}

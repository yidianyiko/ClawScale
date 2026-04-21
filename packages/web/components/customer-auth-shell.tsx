'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { CokePublicShell } from './coke-public-shell';
import { useLocale } from './locale-provider';

function getActiveAuthCta(pathname: string | null): 'signIn' | 'register' | null {
  if (!pathname) {
    return null;
  }

  if (pathname.startsWith('/auth/register') || pathname.startsWith('/auth/claim')) {
    return 'register';
  }

  if (pathname.startsWith('/auth/')) {
    return 'signIn';
  }

  return null;
}

export function CustomerAuthShell({ children }: { children: ReactNode }) {
  const { messages } = useLocale();
  const pathname = usePathname();
  const copy = messages.customerLayout;

  return (
    <CokePublicShell activeAuthCta={getActiveAuthCta(pathname)} contentClassName="auth-shell">
      <div className="auth-shell__grid">
        <section className="auth-hero" aria-label={copy.title}>
          <p className="auth-hero__brand">{copy.brandName}</p>
          <p className="auth-hero__tagline">{copy.brandTagline}</p>
          <p className="auth-hero__eyebrow">{copy.eyebrow}</p>
          <h1 className="auth-hero__title">{copy.title}</h1>
          <p className="auth-hero__body">{copy.body}</p>
          <p className="auth-hero__secondary">{copy.secondaryBody}</p>
          <ul className="auth-hero__trust-list">
            {copy.trustLines.map((line) => (
              <li key={line} className="auth-hero__trust-item">
                {line}
              </li>
            ))}
          </ul>
        </section>

        <div className="auth-shell__content">{children}</div>
      </div>
    </CokePublicShell>
  );
}

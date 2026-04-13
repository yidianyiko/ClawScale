import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '../lib/utils';

interface CokePublicShellProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

const navItems = [
  { href: '/#platforms', label: 'Platforms', sublabel: '平台' },
  { href: '/#features', label: 'Features', sublabel: '功能' },
  { href: '/#architecture', label: 'Architecture', sublabel: '架构' },
  { href: '/#contact', label: 'Contact', sublabel: '联系' },
];

export function CokePublicShell({ children, className, contentClassName }: CokePublicShellProps) {
  return (
    <div
      className={cn(
        'min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.22),_rgba(10,17,29,0.98)_42%,_#050814_100%)] text-white',
        className,
      )}
    >
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-sm font-semibold tracking-[0.2em]">
              CK
            </span>
            <div>
              <p className="text-base font-semibold tracking-tight">Coke AI</p>
              <p className="text-xs text-slate-400">An AI Partner That Grows With You</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-5 text-sm text-slate-300 lg:flex">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className="transition hover:text-white">
                {item.label}
                <span className="ml-1 text-slate-500">/{item.sublabel}</span>
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/coke/login"
              className="inline-flex items-center rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
            >
              Sign in / 登录
            </Link>
            <Link
              href="/coke/register"
              className="inline-flex items-center rounded-full bg-teal-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-teal-300"
            >
              Register / 注册
            </Link>
          </div>
        </div>
      </header>

      <main className={cn('mx-auto max-w-6xl px-6 pb-16', contentClassName)}>{children}</main>
    </div>
  );
}

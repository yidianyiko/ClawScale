import type { ReactNode } from 'react';
import Link from 'next/link';

export default function CokeUserLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-slate-950">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/coke/bind-wechat" className="text-lg font-semibold">
            Coke
          </Link>
          <nav className="text-sm text-slate-500">Bind your personal WeChat</nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-12">{children}</main>
    </div>
  );
}

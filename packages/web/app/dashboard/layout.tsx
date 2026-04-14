'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import { LayoutDashboard, Users, UserCheck, Radio, Settings, LogOut, MessageSquare, Zap, BotMessageSquare } from 'lucide-react';
import { isAuthenticated, clearAuth, getUser, getTenant } from '../../lib/auth';
import { cn } from '../../lib/utils';
import { useLocale } from '../../components/locale-provider';
import { LocaleSwitch } from '../../components/locale-switch';
import { getDashboardCopy } from '../../lib/dashboard-copy';

const navIcons = {
  '/dashboard': LayoutDashboard,
  '/dashboard/conversations': MessageSquare,
  '/dashboard/channels': Radio,
  '/dashboard/ai-backends': BotMessageSquare,
  '/dashboard/workflows': Zap,
  '/dashboard/end-users': UserCheck,
  '/dashboard/users': Users,
  '/dashboard/settings': Settings,
} as const;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { locale, messages } = useLocale();
  const [ready, setReady] = useState(false);
  const copy = getDashboardCopy(locale);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/dashboard/login');
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) return null;

  const user = getUser();
  const tenant = getTenant();

  function handleLogout() {
    clearAuth();
    router.push('/dashboard/login');
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="flex w-60 flex-col bg-navy-900 text-white">
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/10">
          <Image src="/logo.png" alt="ClawScale" width={28} height={28} className="h-7 w-7" />
          <div>
            <span className="font-semibold text-white text-base">ClawScale</span>
            <p className="text-[10px] text-white/40 leading-none mt-0.5">by Pulse</p>
          </div>
        </div>

        {tenant && (
          <div className="mx-4 mt-4 rounded-lg bg-white/5 px-3 py-2">
            <p className="text-xs font-medium text-white/80 truncate">{tenant.name}</p>
          </div>
        )}

        <div className="mx-4 mt-4 rounded-lg border border-white/10 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">{messages.common.languageLabel}</div>
          <div className="mt-2 text-sm text-white/80">
            <LocaleSwitch />
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {copy.layout.nav.map(({ href, label, exact }) => {
            const Icon = navIcons[href as keyof typeof navIcons];
            const isActive = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-teal-500/20 text-teal-400'
                    : 'text-white/60 hover:bg-white/5 hover:text-white',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-500/20 text-teal-400 text-sm font-semibold">
              {user?.name[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-white/40">{user?.role ? copy.layout.roleLabels[user.role] ?? user.role : ''}</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-white/40 hover:text-white transition-colors"
              title={copy.layout.signOutTitle}
              aria-label={copy.layout.signOutTitle}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

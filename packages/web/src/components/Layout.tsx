import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Radio,
  Settings,
  LogOut,
  Hexagon,
} from 'lucide-react';
import { clearAuth, getUser, getTenant } from '../lib/auth.ts';
import { cn } from '../lib/utils.ts';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/channels', icon: Radio, label: 'Channels' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Layout() {
  const navigate = useNavigate();
  const user = getUser();
  const tenant = getTenant();

  function handleLogout() {
    clearAuth();
    navigate('/login');
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col bg-navy-900 text-white">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/10">
          <Hexagon className="h-7 w-7 text-teal-500 fill-teal-500/20" strokeWidth={1.5} />
          <div>
            <span className="font-semibold text-white text-base">ClawScale</span>
            <p className="text-[10px] text-white/40 leading-none mt-0.5">by Pulse</p>
          </div>
        </div>

        {/* Tenant badge */}
        {tenant && (
          <div className="mx-4 mt-4 rounded-lg bg-white/5 px-3 py-2">
            <p className="text-xs font-medium text-white/80 truncate">{tenant.name}</p>
            <p className="text-[10px] text-white/40 mt-0.5 uppercase tracking-wide">{tenant.plan}</p>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-teal-500/20 text-teal-400'
                    : 'text-white/60 hover:bg-white/5 hover:text-white',
                )
              }
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="border-t border-white/10 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-teal-500/20 text-teal-400 text-sm font-semibold">
              {user?.name[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-white/40 capitalize">{user?.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-white/40 hover:text-white transition-colors"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

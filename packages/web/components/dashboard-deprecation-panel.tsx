import Link from 'next/link';
import type { ReactNode } from 'react';

type ActionLink = {
  href: string;
  label: string;
};

type DashboardDeprecationPanelProps = {
  badge: string;
  title: string;
  summary: string;
  detail: string;
  actions: ActionLink[];
  children?: ReactNode;
};

export function DashboardDeprecationPanel({
  badge,
  title,
  summary,
  detail,
  actions,
  children,
}: DashboardDeprecationPanelProps) {
  return (
    <div className="p-8">
      <div className="max-w-3xl rounded-2xl border border-amber-200 bg-amber-50/70 p-8 shadow-sm">
        <span className="inline-flex rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
          {badge}
        </span>
        <h1 className="mt-4 text-3xl font-semibold text-gray-900">{title}</h1>
        <p className="mt-3 text-base text-gray-700">{summary}</p>
        <p className="mt-2 text-sm leading-6 text-gray-600">{detail}</p>
        {children ? <div className="mt-6">{children}</div> : null}
        <div className="mt-8 flex flex-wrap gap-3">
          {actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:text-gray-900"
            >
              {action.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

import { DashboardDeprecationPanel } from '../../../components/dashboard-deprecation-panel';

export default function AiBackendsPage() {
  return (
    <DashboardDeprecationPanel
      badge="Moved"
      title="AI backends moved"
      summary="Backend selection no longer happens in this dashboard."
      detail="Routing now uses the active delivery configuration instead of dashboard-managed backends. Keep the navigation link for compatibility, but direct operational changes through the new channel and delivery flow."
      actions={[
        { href: '/admin/agents', label: 'Open agent details' },
        { href: '/admin/channels', label: 'Review admin channels' },
      ]}
    >
      <div className="rounded-xl border border-white/80 bg-white/80 p-4 text-sm leading-6 text-gray-600">
        The old CRUD surface has been intentionally removed so this page no longer issues AI backend API requests.
      </div>
    </DashboardDeprecationPanel>
  );
}

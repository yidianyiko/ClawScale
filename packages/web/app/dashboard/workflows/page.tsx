import { DashboardDeprecationPanel } from '../../../components/dashboard-deprecation-panel';

export default function WorkflowsPage() {
  return (
    <DashboardDeprecationPanel
      badge="Retired"
      title="Workflows retired"
      summary="Gateway-managed workflow automation has been removed."
      detail="Use channel routing and downstream automation tools for new delivery flows. This page remains in the dashboard shell as a tombstone so existing navigation does not break."
      actions={[
        { href: '/dashboard/channels', label: 'Manage channel routing' },
        { href: '/dashboard', label: 'Back to overview' },
      ]}
    >
      <div className="rounded-xl border border-white/80 bg-white/80 p-4 text-sm leading-6 text-gray-600">
        The removed workflow APIs are no longer queried from the dashboard.
      </div>
    </DashboardDeprecationPanel>
  );
}

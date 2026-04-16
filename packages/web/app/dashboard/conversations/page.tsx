import { DashboardDeprecationPanel } from '../../../components/dashboard-deprecation-panel';

export default function ConversationsPage() {
  return (
    <DashboardDeprecationPanel
      badge="Moved"
      title="Conversations moved"
      summary="Conversation history is no longer available in the gateway dashboard."
      detail="Use the customer-facing Coke surfaces for live conversation review. Gateway route resolution no longer depends on dashboard-managed transcript storage."
      actions={[
        { href: '/dashboard/channels', label: 'Open channels' },
        { href: '/dashboard', label: 'Back to overview' },
      ]}
    >
      <div className="rounded-xl border border-white/80 bg-white/80 p-4 text-sm leading-6 text-gray-600">
        Existing navigation stays in place for compatibility, but this page is now a deprecation notice instead of a data view.
      </div>
    </DashboardDeprecationPanel>
  );
}

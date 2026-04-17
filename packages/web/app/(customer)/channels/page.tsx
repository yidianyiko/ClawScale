import Link from 'next/link';

const phaseOneChannels = [
  {
    href: '/channels/wechat-personal',
    title: 'Personal WeChat',
    description: 'Connect, reconnect, or archive your personal WeChat channel.',
  },
] as const;

export default function CustomerChannelsPage() {
  return (
    <section className="mx-auto max-w-4xl space-y-8">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-500">Phase 1 channels</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Customer channels</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Manage the customer channel surfaces that are available in the neutral ClawScale shell today.
        </p>
      </div>

      <div className="grid gap-4">
        {phaseOneChannels.map((channel) => (
          <Link
            key={channel.href}
            href={channel.href}
            className="rounded-3xl border border-slate-200 bg-slate-50 p-6 transition hover:border-slate-950 hover:bg-white"
          >
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">{channel.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{channel.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

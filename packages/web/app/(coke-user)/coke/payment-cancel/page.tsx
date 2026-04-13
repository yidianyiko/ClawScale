import Link from 'next/link';

export default function PaymentCancelPage() {
  return (
    <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Payment canceled</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        The checkout flow was canceled before payment completed. You can try again when you are ready.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/coke/renew"
          className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Restart renewal
        </Link>
        <Link
          href="/coke/bind-wechat"
          className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
        >
          Back to setup
        </Link>
      </div>
    </section>
  );
}

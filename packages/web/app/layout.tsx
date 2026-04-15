import type { Metadata } from "next";
import Script from "next/script";

import { LocaleProvider } from "../components/locale-provider";
import { getLocaleBootstrapScript } from "../lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "coke | An AI Partner That Grows With You",
  description: "Coke AI public homepage, user sign-in, registration, and personal channel setup.",
  icons: { icon: "/logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script
          id="locale-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: getLocaleBootstrapScript() }}
        />
        <div
          id="locale-splash"
          className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.22),_rgba(10,17,29,0.98)_42%,_#050814_100%)] text-white"
        >
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3 backdrop-blur-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-sm font-semibold tracking-[0.2em]">
              CK
            </span>
            <div>
              <p className="text-base font-semibold tracking-tight">Coke AI</p>
              <p className="text-xs text-slate-300">Preparing your workspace...</p>
            </div>
          </div>
        </div>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}

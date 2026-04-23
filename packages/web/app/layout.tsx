import type { Metadata } from 'next';
import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google';
import Script from 'next/script';

import { LocaleProvider } from '../components/locale-provider';
import { getLocaleBootstrapScript } from '../lib/i18n';
import './globals.css';
import './public-site.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  axes: ['SOFT', 'opsz'],
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'kap | An AI Partner That Grows With You',
  description: 'Kap AI public homepage, user sign-in, registration, and personal channel setup.',
  icons: { icon: '/logo.png' },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
        <Script
          id="locale-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: getLocaleBootstrapScript() }}
        />
        <div id="locale-splash" className="coke-site-splash">
          <div className="coke-site-splash__card">
            <span className="coke-site-splash__mark">kap</span>
            <span className="coke-site-splash__dot" aria-hidden="true" />
            <p className="coke-site-splash__body">Preparing your workspace...</p>
          </div>
        </div>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';

import { GlobalHomepage } from '../../components/global-homepage';

export const metadata: Metadata = {
  title: 'kap global | AI partner on WhatsApp',
  description: 'Start a WhatsApp conversation with Kap and use one thread for planning, coordination, and follow-through.',
};

export default function GlobalPage() {
  return <GlobalHomepage />;
}

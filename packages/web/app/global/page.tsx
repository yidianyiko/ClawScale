import type { Metadata } from 'next';

import { GlobalHomepage } from '../../components/global-homepage';

export const metadata: Metadata = {
  title: 'coke global | AI partner on WhatsApp',
  description: 'Start a WhatsApp conversation with Coke and use one thread for planning, coordination, and follow-through.',
};

export default function GlobalPage() {
  return <GlobalHomepage />;
}

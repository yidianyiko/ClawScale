'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type SearchParamsLike = { toString(): string } | null;

export function buildLegacyRedirectPath(pathname: string, searchParams: SearchParamsLike) {
  const query = searchParams?.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function LegacyRedirectPageContent({ pathname }: { pathname: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    router.replace(buildLegacyRedirectPath(pathname, searchParams));
  }, [pathname, router, searchParams]);

  return null;
}

export default function LegacyRedirectPage({ pathname }: { pathname: string }) {
  return (
    <Suspense fallback={null}>
      <LegacyRedirectPageContent pathname={pathname} />
    </Suspense>
  );
}

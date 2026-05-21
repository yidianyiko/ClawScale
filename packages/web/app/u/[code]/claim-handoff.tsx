'use client';

import { useEffect, useState } from 'react';
import { claimPublicLinkSession } from '../../../lib/user-link-api';

export function UserLinkClaimHandoff({ token }: { token: string }) {
  const [status, setStatus] = useState<'claiming' | 'failed'>('claiming');

  useEffect(() => {
    let cancelled = false;

    async function claim() {
      const result = await claimPublicLinkSession(token);
      if (cancelled) return;
      if (result.ok) {
        window.location.assign('/channels/wechat-personal');
        return;
      }
      setStatus('failed');
    }

    void claim();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (status === 'failed') {
    return <p className="public-user-link__status">Connection could not be completed. Please try signing in again.</p>;
  }

  return <p className="public-user-link__status">Completing your connection...</p>;
}

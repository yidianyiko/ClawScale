import type { ApiResponse } from '../../shared/src/types/api';
import type { PublicUserLinkResponse, PublicUserLinkSession } from '../../shared/src/types/scheduling';
import { getCustomerApiBase } from './customer-api';
import { getCustomerToken } from './customer-auth';

export async function readPublicUserLink(
  code: string,
  options: { openSession?: boolean } = {},
): Promise<ApiResponse<PublicUserLinkResponse>> {
  const base = getCustomerApiBase();
  const encodedCode = encodeURIComponent(code);
  const metaRes = await fetch(`${base}/api/public/user-links/${encodedCode}`, { cache: 'no-store' });
  if (!metaRes.ok) {
    return { ok: false, error: 'link_not_active' };
  }

  const meta = (await metaRes.json()) as ApiResponse<PublicUserLinkResponse>;
  if (!meta.ok) {
    return meta;
  }
  if (options.openSession === false) {
    return meta;
  }

  try {
    const sessionRes = await fetch(`${base}/api/public/user-links/${encodedCode}/sessions`, {
      method: 'POST',
      cache: 'no-store',
    });
    if (!sessionRes.ok) {
      return meta;
    }

    const session = (await sessionRes.json()) as ApiResponse<PublicUserLinkSession>;
    if (!session.ok) {
      return meta;
    }

    return {
      ok: true,
      data: {
        ...meta.data,
        session: session.data,
      },
    };
  } catch {
    return meta;
  }
}

export async function claimPublicLinkSession(token: string): Promise<ApiResponse<{ status: string }>> {
  const customerToken = getCustomerToken();
  if (!customerToken) {
    return { ok: false, error: 'unauthorized' };
  }

  const res = await fetch(`${getCustomerApiBase()}/api/public/link-sessions/${encodeURIComponent(token)}/claim`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${customerToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) {
    return { ok: false, error: 'link_session_not_claimable' };
  }
  return (await res.json()) as ApiResponse<{ status: string }>;
}

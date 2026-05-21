import type { ApiResponse } from '../../shared/src/types/api';
import type { PublicUserLinkResponse, PublicUserLinkSession } from '../../shared/src/types/scheduling';
import { getCustomerApiBase } from './customer-api';

export async function readPublicUserLink(code: string): Promise<ApiResponse<PublicUserLinkResponse>> {
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

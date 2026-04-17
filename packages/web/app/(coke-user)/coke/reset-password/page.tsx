import { redirect } from 'next/navigation';

type LegacySearchParams = Record<string, string | string[] | undefined>;

function buildRedirectPath(pathname: string, searchParams?: LegacySearchParams) {
  const params = new URLSearchParams();

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (Array.isArray(value)) {
        for (const entry of value) {
          params.append(key, entry);
        }
        continue;
      }

      if (value !== undefined) {
        params.set(key, value);
      }
    }
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<LegacySearchParams>;
}) {
  redirect(buildRedirectPath('/auth/reset-password', searchParams ? await searchParams : undefined));
}

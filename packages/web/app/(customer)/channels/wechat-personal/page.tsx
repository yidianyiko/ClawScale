import { redirect } from 'next/navigation';

type ChannelSearchParams = Record<string, string | string[] | undefined>;

function getSearchParamValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export default async function CustomerWechatPersonalPage({
  searchParams,
}: {
  searchParams?: Promise<ChannelSearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const next = getSearchParamValue(resolvedSearchParams?.next);

  redirect(next === 'renew' ? '/coke/renew' : '/coke/bind-wechat');
}

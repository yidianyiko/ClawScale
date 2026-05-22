import Link from 'next/link';
import { fetchUserLink, openLinkSession } from '../../../lib/user-link-api';
import { ClaimHandoff } from './claim-handoff';

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function UserLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const query = searchParams ? await searchParams : {};
  const linkSessionToken = firstSearchParam(query.link_session);
  const result = await fetchUserLink(code);

  if (!result.ok) {
    return (
      <main className="coke-site public-user-link">
        <section className="public-user-link__panel" aria-labelledby="user-link-inactive-title">
          <h1 id="user-link-inactive-title">Link no longer active</h1>
          <p>This user link cannot start new friend requests.</p>
        </section>
      </main>
    );
  }

  const link = result.data;
  const { profile } = link;
  const linkSession = !linkSessionToken ? await openLinkSession(code) : null;
  const openedLinkSession = linkSession?.ok ? linkSession.data : null;
  const linkSessionFailed = linkSession?.ok === false;

  return (
    <main className="coke-site public-user-link">
      <section className="public-user-link__panel" aria-labelledby="user-link-title">
        {profile.avatarUrl ? (
          <img
            className="public-user-link__avatar"
            src={profile.avatarUrl}
            alt=""
            width={72}
            height={72}
          />
        ) : null}
        <h1 id="user-link-title">{profile.displayName}</h1>
        {profile.tagline ? <p>{profile.tagline}</p> : null}
        <img
          className="public-user-link__qr"
          src={`/u/${encodeURIComponent(code)}/qr`}
          alt=""
          width={160}
          height={160}
        />
        {openedLinkSession ? (
          <div className="public-user-link__actions">
            <Link href={openedLinkSession.loginUrl}>Log in to add friend</Link>
            <Link href={openedLinkSession.registerUrl}>Create account to add friend</Link>
          </div>
        ) : null}
        {linkSessionFailed ? (
          <p className="public-user-link__status">
            Friend request setup is temporarily unavailable. Please refresh this page and try again.
          </p>
        ) : null}
        {linkSessionToken ? (
          <ClaimHandoff token={linkSessionToken} targetName={link.profile.displayName} />
        ) : null}
      </section>
    </main>
  );
}

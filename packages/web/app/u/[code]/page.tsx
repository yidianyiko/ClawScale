import Link from 'next/link';
import { readPublicUserLink } from '../../../lib/user-link-api';
import { UserLinkClaimHandoff } from './claim-handoff';

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
  const result = await readPublicUserLink(code, { openSession: !linkSessionToken });

  if (!result.ok) {
    return (
      <main className="coke-site public-user-link">
        <section className="public-user-link__panel" aria-labelledby="user-link-inactive-title">
          <h1 id="user-link-inactive-title">Link no longer active</h1>
          <p>This user link cannot create new connection sessions.</p>
        </section>
      </main>
    );
  }

  const { profile, session } = result.data;
  const sessionNext = `/u/${encodeURIComponent(code)}${linkSessionToken ? `?link_session=${encodeURIComponent(linkSessionToken)}` : ''}`;
  const loginHref = session?.nextUrl ?? `/auth/login?next=${encodeURIComponent(sessionNext)}`;
  const registerHref = session?.registerUrl ?? `/auth/register?next=${encodeURIComponent(sessionNext)}`;

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
        {linkSessionToken ? <UserLinkClaimHandoff token={linkSessionToken} /> : null}
        <div className="public-user-link__actions">
          <Link href={loginHref}>Log in to connect</Link>
          <Link href={registerHref}>Create account to connect</Link>
        </div>
      </section>
    </main>
  );
}

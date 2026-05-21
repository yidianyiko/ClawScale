import Link from 'next/link';
import { readPublicUserLink } from '../../../lib/user-link-api';

export default async function UserLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const result = await readPublicUserLink(code);

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
        <div className="public-user-link__actions">
          <Link href={session?.nextUrl ?? '/auth/login'}>Log in to connect</Link>
          <Link href={session?.registerUrl ?? '/auth/register'}>Create account to connect</Link>
        </div>
      </section>
    </main>
  );
}

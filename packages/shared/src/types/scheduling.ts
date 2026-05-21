export interface PublicUserLinkProfile {
  displayName: string;
  tagline: string | null;
  avatarUrl: string | null;
}

export interface PublicUserLinkSession {
  token?: string;
  nextUrl: string;
  registerUrl: string;
}

export interface PublicUserLinkResponse {
  code: string;
  url: string;
  qrUrl: string;
  profile: PublicUserLinkProfile;
  session?: PublicUserLinkSession;
}

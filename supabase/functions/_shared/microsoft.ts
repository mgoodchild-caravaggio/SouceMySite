// Microsoft identity platform and Graph helpers for each person's Outlook connection.
import { decrypt, encrypt } from './crypto.ts';
import { adminClient, HttpError } from './supabase.ts';

export const SCOPES = [
  'offline_access',
  'openid',
  'email',
  'profile',
  'User.Read',
  'Calendars.ReadWrite',
  'Mail.Send',
  'Mail.Read',
].join(' ');

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const authority = () => `https://login.microsoftonline.com/${env('MS_TENANT_ID')}/oauth2/v2.0`;
export const callbackUrl = () => `${env('SUPABASE_URL')}/functions/v1/outlook-callback`;

export function authorizeUrl(state: string, loginHint?: string): string {
  const u = new URL(`${authority()}/authorize`);
  u.search = new URLSearchParams({
    client_id: env('MS_CLIENT_ID'),
    response_type: 'code',
    redirect_uri: callbackUrl(),
    response_mode: 'query',
    scope: SCOPES,
    state,
    prompt: 'select_account',
    ...(loginHint && { login_hint: loginHint }),
  }).toString();
  return u.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${authority()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('MS_CLIENT_ID'), client_secret: env('MS_CLIENT_SECRET'), ...params }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description?.split('\r\n')[0] ?? body.error ?? `Token request failed (${res.status})`);
  return body as TokenResponse;
}

export const redeemCode = (code: string) =>
  tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(), scope: SCOPES });

/** A fresh Graph access token for a Hub user, refreshing (and re-storing) their Outlook token. */
export async function graphToken(userId: string): Promise<string> {
  const db = adminClient();
  const { data: conn } = await db.from('outlook_connections').select('refresh_token').eq('user_id', userId).maybeSingle();
  if (!conn) throw new HttpError(409, 'Connect Outlook first (Settings → Outlook).');
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: await decrypt(conn.refresh_token), scope: SCOPES });
    await db
      .from('outlook_connections')
      .update({
        ...(t.refresh_token && { refresh_token: await encrypt(t.refresh_token) }),
        last_used_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('user_id', userId);
    return t.access_token;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from('outlook_connections').update({ last_error: message }).eq('user_id', userId);
    throw new HttpError(409, `Outlook needs reconnecting: ${message}`);
  }
}

/** Calls Microsoft Graph as the user. */
export async function graph<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Outlook said: ${body.error?.message ?? res.statusText}`);
  return body as T;
}

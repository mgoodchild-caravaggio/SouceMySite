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

/** Real Estate and Staging each have their own Microsoft 365 mailbox. */
export const BUSINESSES = ['Real Estate', 'Staging'] as const;
export type Business = (typeof BUSINESSES)[number];

/** The business a request names, defaulting to Real Estate. */
export function businessOf(value: unknown): Business {
  if (value === undefined || value === null || value === '') return 'Real Estate';
  if (!BUSINESSES.includes(value as Business)) throw new HttpError(400, 'Unknown business');
  return value as Business;
}

/** A fresh Graph access token for a Hub user's mailbox for one business, refreshing (and re-storing) the token. */
export async function graphToken(userId: string, business: Business): Promise<string> {
  const db = adminClient();
  const { data: conn } = await db.from('outlook_connections').select('refresh_token').eq('user_id', userId).eq('business', business).maybeSingle();
  if (!conn) throw new HttpError(409, `Connect your ${business} mailbox first (Settings → Outlook).`);
  let refreshToken: string;
  try {
    refreshToken = await decrypt(conn.refresh_token);
  } catch {
    const message = 'The saved Outlook connection could not be read. Please reconnect.';
    await db.from('outlook_connections').update({ last_error: message }).eq('user_id', userId).eq('business', business);
    throw new HttpError(409, message);
  }
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPES });
    await db
      .from('outlook_connections')
      .update({
        ...(t.refresh_token && { refresh_token: await encrypt(t.refresh_token) }),
        last_used_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('user_id', userId)
      .eq('business', business);
    return t.access_token;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from('outlook_connections').update({ last_error: message }).eq('user_id', userId).eq('business', business);
    throw new HttpError(409, `Your ${business} mailbox needs reconnecting: ${message}`);
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

/** Hub works in Toronto time; Graph returns and accepts wall-clock times in this zone. */
export const TIME_ZONE = 'America/Toronto';
export const tzHeader = { Prefer: `outlook.timezone="${TIME_ZONE}"` };

/** Accepts "YYYY-MM-DDTHH:mm" (Toronto wall time) and rejects anything else. */
export function wallTime(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    throw new HttpError(400, `${field} must look like 2026-11-20T10:00`);
  }
  return value.length === 16 ? `${value}:00` : value;
}

/** Converts a Toronto wall time to a UTC ISO string (handles daylight saving). */
export function torontoToUtc(wall: string): string {
  const [d, t] = wall.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  // Find Toronto's offset at that moment, then correct the guess.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (k: string) => Number(parts.find((p) => p.type === k)!.value);
  const asToronto = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess + (guess - asToronto)).toISOString();
}

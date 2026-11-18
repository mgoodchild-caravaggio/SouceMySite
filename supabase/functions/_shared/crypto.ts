// AES-GCM encryption for stored Outlook refresh tokens, and HMAC-signed OAuth state.
// TOKEN_KEY is a base64 32-byte secret set with `supabase secrets set`; it never touches the database.

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

function rawKey(): Uint8Array {
  const k = Deno.env.get('TOKEN_KEY');
  if (!k) throw new Error('TOKEN_KEY is not set');
  const bytes = unb64(k);
  if (bytes.length !== 32) throw new Error('TOKEN_KEY must be 32 bytes, base64-encoded');
  return bytes;
}

const aesKey = () => crypto.subtle.importKey('raw', rawKey(), 'AES-GCM', false, ['encrypt', 'decrypt']);
const hmacKey = () => crypto.subtle.importKey('raw', rawKey(), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function encrypt(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(), enc.encode(plain)));
  return `v1.${b64(iv)}.${b64(cipher)}`;
}

export async function decrypt(stored: string): Promise<string> {
  const [v, iv, cipher] = stored.split('.');
  if (v !== 'v1' || !iv || !cipher) throw new Error('Unrecognised token format');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(), unb64(cipher));
  return dec.decode(plain);
}

/** Signs a small JSON payload for the OAuth `state` parameter. */
export async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** Verifies and decodes a state from signState; throws if tampered with or expired. */
export async function verifyState<T extends { exp: number }>(state: string): Promise<T> {
  const [body, sig] = state.split('.');
  if (!body || !sig) throw new Error('Malformed state');
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(), unb64url(sig), enc.encode(body));
  if (!ok) throw new Error('State signature mismatch');
  const payload = JSON.parse(dec.decode(unb64url(body))) as T;
  if (payload.exp < Date.now()) throw new Error('This connection link expired. Please try again.');
  return payload;
}

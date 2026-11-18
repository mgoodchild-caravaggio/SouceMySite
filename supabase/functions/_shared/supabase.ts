import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** Server-side client with full access; only ever used inside Edge Functions. */
export function adminClient(): SupabaseClient {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not available');
  return createClient(Deno.env.get('SUPABASE_URL')!, key, { auth: { persistSession: false } });
}

/** The signed-in Hub user making the request, from their Authorization header. */
export async function requireUser(req: Request) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Sign in to Hub first.');
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Your Hub session has expired. Sign in again.');
  return data.user;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Browsers may only call these functions from Hub itself.
const ALLOWED = (Deno.env.get('APP_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export function isAllowedOrigin(origin: string | null): origin is string {
  return !!origin && ALLOWED.includes(origin);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : ALLOWED[0] ?? '',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

/** Wraps a JSON handler with CORS and error handling. */
export function jsonHandler(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      const body = await fn(req);
      return Response.json(body ?? {}, { headers: cors });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof Error ? e.message : 'Something went wrong';
      if (status === 500) console.error(e);
      return Response.json({ error: message }, { status, headers: cors });
    }
  };
}

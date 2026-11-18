// Starts "Connect Outlook": returns the Microsoft sign-in URL for the signed-in Hub user.
import { signState } from '../_shared/crypto.ts';
import { authorizeUrl } from '../_shared/microsoft.ts';
import { HttpError, isAllowedOrigin, jsonHandler, requireUser } from '../_shared/supabase.ts';

Deno.serve(
  jsonHandler(async (req) => {
    const user = await requireUser(req);
    const { returnTo } = (await req.json().catch(() => ({}))) as { returnTo?: string };
    // Only send people back to Hub itself.
    const back = returnTo ? new URL(returnTo) : null;
    if (!back || !isAllowedOrigin(back.origin)) throw new HttpError(400, 'Unknown return address');
    const state = await signState({ uid: user.id, ret: back.toString(), exp: Date.now() + 10 * 60_000, n: crypto.randomUUID() });
    return { url: authorizeUrl(state, user.email ?? undefined) };
  }),
);

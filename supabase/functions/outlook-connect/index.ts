// Starts "Connect Outlook": returns the Microsoft sign-in URL for the signed-in Hub user's mailbox
// for one business (Real Estate or Staging use different mailboxes).
import { signState } from '../_shared/crypto.ts';
import { authorizeUrl, businessOf } from '../_shared/microsoft.ts';
import { HttpError, isAllowedOrigin, jsonHandler, requireUser } from '../_shared/supabase.ts';

Deno.serve(
  jsonHandler(async (req) => {
    const user = await requireUser(req);
    const { returnTo, business: b } = (await req.json().catch(() => ({}))) as { returnTo?: string; business?: string };
    const business = businessOf(b);
    // Only send people back to Hub itself.
    const back = returnTo ? new URL(returnTo) : null;
    if (!back || !isAllowedOrigin(back.origin)) throw new HttpError(400, 'Unknown return address');
    const state = await signState({ uid: user.id, biz: business, ret: back.toString(), exp: Date.now() + 10 * 60_000, n: crypto.randomUUID() });
    // Their Hub sign-in is their Real Estate account; the Staging mailbox is a different account.
    return { url: authorizeUrl(state, business === 'Real Estate' ? user.email ?? undefined : undefined) };
  }),
);

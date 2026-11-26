// Removes the signed-in user's Outlook connection for one business from Hub.
import { businessOf } from '../_shared/microsoft.ts';
import { adminClient, jsonHandler, requireUser } from '../_shared/supabase.ts';

Deno.serve(
  jsonHandler(async (req) => {
    const user = await requireUser(req);
    const { business } = await req.json().catch(() => ({}));
    const { error } = await adminClient().from('outlook_connections').delete().eq('user_id', user.id).eq('business', businessOf(business));
    if (error) throw error;
    return { ok: true };
  }),
);

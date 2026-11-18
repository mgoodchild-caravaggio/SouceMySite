// Removes the signed-in user's Outlook connection from Hub.
import { adminClient, jsonHandler, requireUser } from '../_shared/supabase.ts';

Deno.serve(
  jsonHandler(async (req) => {
    const user = await requireUser(req);
    const { error } = await adminClient().from('outlook_connections').delete().eq('user_id', user.id);
    if (error) throw error;
    return { ok: true };
  }),
);

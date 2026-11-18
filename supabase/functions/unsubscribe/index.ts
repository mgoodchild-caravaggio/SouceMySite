// Unsubscribes a campaign recipient by the secret token in their email's link. Works for the
// one-click button in mail apps (POST ?t=…) and Hub's /unsubscribe page (POST {token}). No sign-in.
import { adminClient, corsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response('Use POST', { status: 405, headers: cors });
  const url = new URL(req.url);
  let token = url.searchParams.get('t') ?? '';
  if (!token && req.headers.get('content-type')?.includes('application/json')) token = String((await req.json().catch(() => ({}))).token ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(token)) return Response.json({ error: 'This unsubscribe link is not valid' }, { status: 400, headers: cors });

  const db = adminClient();
  const { data: send } = await db.from('campaign_sends').select('id, contact_id, email, unsubscribed_at').eq('unsub_token', token).maybeSingle();
  if (!send) return Response.json({ error: 'This unsubscribe link is not valid' }, { status: 404, headers: cors });
  const now = new Date().toISOString();
  if (!send.unsubscribed_at) {
    await db.from('campaign_sends').update({ unsubscribed_at: now }).eq('id', send.id);
    await db.from('email_suppressions').upsert({ email: send.email, reason: 'unsubscribed', contact_id: send.contact_id, created_by: null }, { onConflict: 'email', ignoreDuplicates: true });
    if (send.contact_id) {
      await db.from('contacts').update({ unsubscribed_at: now }).eq('id', send.contact_id).is('unsubscribed_at', null);
      await db.from('activities').insert({ contact_id: send.contact_id, kind: 'unsubscribed', body: 'Unsubscribed from marketing email using the link in a campaign' });
    }
  }
  // Show just enough of the address for the person to recognise it.
  const [user, domain] = send.email.split('@');
  return Response.json({ ok: true, email: `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}` }, { headers: cors });
});

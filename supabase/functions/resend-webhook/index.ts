// Receives delivery events from Resend (delivered, opened, clicked, bounced, complained) and updates
// each recipient. Hard bounces and spam complaints go on the do-not-email list.
import { adminClient } from '../_shared/supabase.ts';

const enc = new TextEncoder();

/** Verifies Resend's (Svix) webhook signature. */
async function verify(req: Request, raw: string): Promise<boolean> {
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  const id = req.headers.get('svix-id');
  const ts = req.headers.get('svix-timestamp');
  const sigs = req.headers.get('svix-signature');
  if (!secret || !id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // reject replays
  const key = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${id}.${ts}.${raw}`)));
  const expected = btoa(String.fromCharCode(...mac));
  return sigs.split(' ').some((s) => s.split(',')[1] === expected);
}

Deno.serve(async (req) => {
  const raw = await req.text();
  if (!(await verify(req, raw))) return new Response('Invalid signature', { status: 401 });
  const event = JSON.parse(raw) as { type: string; created_at: string; data: { email_id: string; bounce?: { type?: string; message?: string } } };
  const db = adminClient();
  const { data: send } = await db.from('campaign_sends').select('id, contact_id, email, status').eq('resend_id', event.data.email_id).maybeSingle();
  if (!send) return Response.json({ ok: true, ignored: 'not a campaign email' });
  const at = event.created_at ?? new Date().toISOString();

  switch (event.type) {
    case 'email.delivered':
      if (send.status === 'sent') await db.from('campaign_sends').update({ status: 'delivered', delivered_at: at }).eq('id', send.id);
      break;
    case 'email.opened':
      await db.from('campaign_sends').update({ opened_at: at }).eq('id', send.id).is('opened_at', null);
      break;
    case 'email.clicked':
      await db.from('campaign_sends').update({ clicked_at: at }).eq('id', send.id).is('clicked_at', null);
      await db.from('campaign_sends').update({ opened_at: at }).eq('id', send.id).is('opened_at', null);
      break;
    case 'email.bounced': {
      const permanent = (event.data.bounce?.type ?? 'Permanent') === 'Permanent';
      await db.from('campaign_sends').update({ status: 'bounced', bounced_at: at, error: event.data.bounce?.message ?? null }).eq('id', send.id);
      if (permanent) {
        await db.from('email_suppressions').upsert({ email: send.email, reason: 'bounced', contact_id: send.contact_id, created_by: null }, { onConflict: 'email', ignoreDuplicates: true });
        if (send.contact_id) await db.from('activities').insert({ contact_id: send.contact_id, kind: 'bounced', body: `${send.email} bounced and was added to the do-not-email list` });
      }
      break;
    }
    case 'email.complained':
      await db.from('campaign_sends').update({ status: 'complained', unsubscribed_at: at }).eq('id', send.id);
      await db.from('email_suppressions').upsert({ email: send.email, reason: 'complained', contact_id: send.contact_id, created_by: null }, { onConflict: 'email', ignoreDuplicates: true });
      if (send.contact_id) {
        await db.from('contacts').update({ unsubscribed_at: at }).eq('id', send.contact_id).is('unsubscribed_at', null);
        await db.from('activities').insert({ contact_id: send.contact_id, kind: 'unsubscribed', body: 'Marked a campaign email as spam' });
      }
      break;
  }
  return Response.json({ ok: true });
});

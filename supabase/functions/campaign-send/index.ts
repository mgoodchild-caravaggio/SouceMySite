// Campaign actions from Hub:
//   test     — anyone: sends one copy to yourself, filled in with a real contact's details.
//   send     — admins: checks consent for each chosen contact, queues them, and sends (now or at a set time).
//   cancel   — admins: stops a scheduled or sending campaign; anyone not yet emailed is skipped.
import { exclusionReason, fromAddress, mergeValues, orgFor, orgProblem, processQueued, render, resendSingle, senderFor, unsubscribePageUrl, type ContactRow } from '../_shared/campaign.ts';
import { adminClient, HttpError, jsonHandler, requireUser } from '../_shared/supabase.ts';

Deno.serve(
  jsonHandler(async (req) => {
    const user = await requireUser(req);
    const b = await req.json().catch(() => ({}));
    const db = adminClient();
    const [{ data: campaign }, { data: me }] = await Promise.all([
      db.from('campaigns').select('*').eq('id', String(b.campaignId)).maybeSingle(),
      db.from('profiles').select('id, role, email, display_name').eq('id', user.id).single(),
    ]);
    if (!campaign) throw new HttpError(404, 'Campaign not found');
    const org = await orgFor(db, campaign.business);
    const isAdmin = me?.role === 'admin';

    if (b.action === 'cancel') {
      if (!isAdmin) throw new HttpError(403, 'Only admins can stop a campaign');
      if (!['scheduled', 'sending'].includes(campaign.status)) throw new HttpError(409, 'This campaign is not waiting to send');
      await db.from('campaign_sends').update({ status: 'skipped', error: 'campaign stopped' }).eq('campaign_id', campaign.id).eq('status', 'queued');
      await db.from('campaigns').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', campaign.id);
      return { ok: true };
    }

    if (b.action === 'send' && !isAdmin) throw new HttpError(403, 'Only admins can send campaigns. Save it and ask an admin to send it.');
    const problem = orgProblem(org, campaign.business);
    if (problem) throw new HttpError(409, problem);
    if (!campaign.subject.trim() || !campaign.body.trim()) throw new HttpError(400, 'Add a subject and message first');
    const sender = await senderFor(db, campaign.business, campaign.sender_id ?? user.id).catch((e) => {
      throw new HttpError(409, e.message);
    });

    const contactIds: string[] = Array.isArray(b.contactIds) ? b.contactIds.map(String).slice(0, 5000) : [];

    if (b.action === 'test') {
      // A real contact's details make the test realistic; the unsubscribe link in a test goes nowhere.
      let sample: ContactRow | null = null;
      if (contactIds[0]) {
        const { data } = await db.from('contacts').select('*, properties(address)').eq('id', contactIds[0]).maybeSingle();
        sample = data as ContactRow | null;
      }
      const msg = render({
        subject: campaign.subject,
        body: campaign.body,
        signature: sender.signature,
        org: org!,
        values: mergeValues(sample, sender.name),
        unsubUrl: unsubscribePageUrl('00000000-0000-0000-0000-000000000000'),
      });
      const { from, replyTo } = fromAddress(sender.name, sender.email, org!.sending_domain);
      await resendSingle({ from, reply_to: replyTo, to: [me!.email], subject: `[Test] ${msg.subject}`, html: msg.html, text: msg.text });
      return { ok: true, to: me!.email };
    }

    if (b.action !== 'send') throw new HttpError(400, 'Unknown action');
    if (!isAdmin) throw new HttpError(403, 'Only admins can send campaigns. Save it and ask an admin to send it.');
    if (campaign.status !== 'draft') throw new HttpError(409, 'This campaign has already been sent or scheduled');
    if (!contactIds.length) throw new HttpError(400, 'The audience is empty');

    // Check every contact on the server, whatever the browser said.
    // Look people up in chunks: one request with hundreds of IDs would be too long.
    const chunks = <T,>(list: T[], size = 200) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
    const contacts: ContactRow[] = [];
    for (const ids of chunks(contactIds)) {
      const { data, error } = await db.from('contacts').select('*').in('id', ids).eq('business', campaign.business);
      if (error) throw error;
      contacts.push(...((data ?? []) as ContactRow[]));
    }
    const emails = contacts.map((c) => c.email?.toLowerCase()).filter(Boolean) as string[];
    const suppressed = new Set<string>();
    for (const list of chunks(emails)) {
      const { data } = await db.from('email_suppressions').select('email').in('email', list);
      for (const s of data ?? []) suppressed.add(s.email);
    }
    const seen = new Set<string>();
    const queue = contacts.filter((c) => {
      if (exclusionReason(c, suppressed)) return false;
      const e = c.email!.toLowerCase();
      if (seen.has(e)) return false; // one email per address, even if two contacts share it
      seen.add(e);
      return true;
    });
    if (!queue.length) throw new HttpError(400, 'None of these contacts can receive marketing email');

    const scheduleFor = b.scheduleFor ? new Date(String(b.scheduleFor)) : null;
    if (scheduleFor && (isNaN(scheduleFor.getTime()) || scheduleFor.getTime() < Date.now() - 60_000)) throw new HttpError(400, 'Pick a time in the future');

    for (const part of chunks(queue, 500)) {
      const { error } = await db.from('campaign_sends').insert(part.map((c) => ({ campaign_id: campaign.id, contact_id: c.id, email: c.email!.toLowerCase() })));
      if (error) throw error;
    }
    const later = scheduleFor && scheduleFor.getTime() > Date.now() + 60_000;
    await db
      .from('campaigns')
      .update({ status: later ? 'scheduled' : 'sending', scheduled_for: later ? scheduleFor!.toISOString() : null, started_at: later ? null : new Date().toISOString() })
      .eq('id', campaign.id);

    // Start sending straight away; anything over Resend's limits is picked up by the worker.
    const first = later ? null : await processQueued(db, campaign.id, 100);
    return { ok: true, queued: queue.length, excluded: contactIds.length - queue.length, scheduled: !!later, firstBatch: first };
  }),
);

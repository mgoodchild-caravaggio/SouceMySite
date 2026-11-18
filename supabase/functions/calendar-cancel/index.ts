// Cancels a Hub-scheduled meeting in the organiser's Outlook (attendees are notified) and records it.
import { graph, graphToken } from '../_shared/microsoft.ts';
import { adminClient, HttpError, jsonHandler, requireUser } from '../_shared/supabase.ts';

Deno.serve(
  jsonHandler(async (req) => {
    const user = await requireUser(req);
    const b = await req.json().catch(() => ({}));
    const db = adminClient();
    const { data: m } = await db.from('meetings').select('*').eq('id', String(b.meetingId)).maybeSingle();
    if (!m) throw new HttpError(404, 'Meeting not found');
    if (m.organizer_id !== user.id) throw new HttpError(403, 'Only the person who scheduled it can cancel it');
    if (m.status === 'cancelled') return { ok: true };
    if (m.outlook_event_id) {
      const token = await graphToken(user.id);
      const comment = String(b.comment ?? '').slice(0, 500);
      try {
        await graph(token, `/me/events/${encodeURIComponent(m.outlook_event_id)}/cancel`, { method: 'POST', body: JSON.stringify({ comment }) });
      } catch (e) {
        // Already deleted in Outlook: still mark it cancelled in Hub.
        if (!(e instanceof HttpError) || !/not found/i.test(e.message)) throw e;
      }
    }
    await db.from('meetings').update({ status: 'cancelled' }).eq('id', m.id);
    await db.from('activities').insert({ contact_id: m.contact_id, kind: 'meeting', body: `Cancelled: ${m.subject}`, created_by: user.id });
    return { ok: true };
  }),
);

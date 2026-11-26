// The Calendar page's changes to the signed-in user's own Outlook calendar (the mailbox of the business
// they're working in: Real Estate and Staging have separate mailboxes):
//   create  - an event with no contact (meetings with a contact go through calendar-schedule)
//   update  - title, time, all-day, location, notes
//   cancel  - cancel (organiser, with attendees: they're told) or delete (just me)
//   respond - accept / tentatively accept / decline an invitation
// When the event is a Hub meeting with a contact, the meetings table and the contact's timeline stay in step.
import { businessOf, graph, graphToken, TIME_ZONE, torontoToUtc, wallTime } from '../_shared/microsoft.ts';
import { adminClient, HttpError, jsonHandler, requireUser } from '../_shared/supabase.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const toHtml = (notes: string) => esc(notes).replace(/\n/g, '<br>');
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Graph wants all-day events from midnight to midnight; `end` is exclusive (the day after the last day). */
function times(b: Record<string, unknown>) {
  const allDay = !!b.allDay;
  let start = wallTime(b.start, 'start');
  let end = wallTime(b.end, 'end');
  if (allDay) {
    start = `${start.slice(0, 10)}T00:00:00`;
    end = `${end.slice(0, 10)}T00:00:00`;
    if (end <= start) {
      const d = new Date(`${start.slice(0, 10)}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      end = `${d.toISOString().slice(0, 10)}T00:00:00`;
    }
  } else if (end <= start) throw new HttpError(400, 'The event must end after it starts');
  return { allDay, start, end };
}

const eventPath = (id: unknown) => {
  if (typeof id !== 'string' || !id || id.length > 400) throw new HttpError(400, 'Which event?');
  return `/me/events/${encodeURIComponent(id)}`;
};

Deno.serve(
  jsonHandler(async (req) => {
    const user = await requireUser(req);
    const b = await req.json().catch(() => ({}));
    const db = adminClient();
    const business = businessOf(b.business);
    const token = await graphToken(user.id, business);
    // A Hub meeting with a contact, if this event is one of the user's own.
    const hubMeeting = async (id: string) =>
      (await db.from('meetings').select('id, contact_id, subject, status').eq('outlook_event_id', id).eq('organizer_id', user.id).eq('mailbox_business', business).maybeSingle()).data;

    switch (b.action) {
      case 'create': {
        const subject = String(b.subject ?? '').trim().slice(0, 200);
        if (!subject) throw new HttpError(400, 'Add a title');
        const { allDay, start, end } = times(b);
        const location = String(b.location ?? '').trim().slice(0, 300);
        const notes = String(b.notes ?? '').trim().slice(0, 4000);
        // Invitees: teammates by id, plus any other addresses typed in.
        const attendees: { address: string; name: string }[] = [];
        const teammateIds: string[] = Array.isArray(b.teammateIds) ? b.teammateIds.map(String).slice(0, 10) : [];
        if (teammateIds.length) {
          const { data: mates } = await db.from('profiles').select('id, email, display_name').in('id', teammateIds);
          for (const m of mates ?? []) if (m.id !== user.id) attendees.push({ address: m.email, name: m.display_name || m.email });
        }
        const extra: string[] = Array.isArray(b.emails) ? b.emails.map((e: unknown) => String(e).trim().toLowerCase()).filter(Boolean).slice(0, 20) : [];
        for (const e of extra) {
          if (!EMAIL.test(e)) throw new HttpError(400, `“${e}” isn't an email address`);
          if (!attendees.some((a) => a.address.toLowerCase() === e)) attendees.push({ address: e, name: e });
        }
        const event = await graph<{ id: string }>(token, '/me/events', {
          method: 'POST',
          body: JSON.stringify({
            subject,
            body: { contentType: 'HTML', content: notes ? toHtml(notes) : '' },
            start: { dateTime: start, timeZone: TIME_ZONE },
            end: { dateTime: end, timeZone: TIME_ZONE },
            isAllDay: allDay,
            showAs: b.showAs === 'free' ? 'free' : 'busy',
            location: location ? { displayName: location } : undefined,
            attendees: attendees.map((a) => ({ emailAddress: a, type: 'required' })),
            isOnlineMeeting: !!b.teams && attendees.length > 0,
            ...(b.teams && attendees.length > 0 && { onlineMeetingProvider: 'teamsForBusiness' }),
            categories: ['Hub'],
          }),
        });
        return { id: event.id };
      }

      case 'update': {
        const path = eventPath(b.id);
        const patch: Record<string, unknown> = {};
        if (b.subject !== undefined) {
          const subject = String(b.subject).trim().slice(0, 200);
          if (!subject) throw new HttpError(400, 'Add a title');
          patch.subject = subject;
        }
        let when: ReturnType<typeof times> | null = null;
        if (b.start !== undefined || b.end !== undefined) {
          when = times(b);
          patch.start = { dateTime: when.start, timeZone: TIME_ZONE };
          patch.end = { dateTime: when.end, timeZone: TIME_ZONE };
          patch.isAllDay = when.allDay;
        }
        if (b.location !== undefined) patch.location = { displayName: String(b.location).trim().slice(0, 300) };
        if (b.notes !== undefined) patch.body = { contentType: 'HTML', content: toHtml(String(b.notes).trim().slice(0, 4000)) };
        await graph(token, path, { method: 'PATCH', body: JSON.stringify(patch) });

        const m = await hubMeeting(b.id);
        if (m && m.status === 'scheduled') {
          const row: Record<string, unknown> = {};
          if (patch.subject) row.subject = patch.subject;
          if (when) {
            row.starts_at = torontoToUtc(when.start);
            row.ends_at = torontoToUtc(when.end);
          }
          if (b.location !== undefined) row.location = String(b.location).trim().slice(0, 300);
          if (Object.keys(row).length) await db.from('meetings').update(row).eq('id', m.id);
          if (when) {
            const label = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
              new Date(torontoToUtc(when.start)),
            );
            await db.from('activities').insert({ contact_id: m.contact_id, kind: 'meeting', body: `Moved to ${label}: ${patch.subject ?? m.subject}`, created_by: user.id });
          }
        }
        return { ok: true };
      }

      case 'cancel': {
        const path = eventPath(b.id);
        const ev = await graph<{ isOrganizer: boolean; attendees?: unknown[] }>(token, `${path}?$select=isOrganizer,attendees`);
        try {
          if (ev.isOrganizer && (ev.attendees?.length ?? 0) > 0) {
            // Everyone invited gets a cancellation.
            await graph(token, `${path}/cancel`, { method: 'POST', body: JSON.stringify({ comment: String(b.comment ?? '').slice(0, 500) }) });
          } else if (!ev.isOrganizer) {
            // Someone else's meeting: decline it, so the organiser knows, and it leaves the calendar.
            await graph(token, `${path}/decline`, { method: 'POST', body: JSON.stringify({ comment: String(b.comment ?? '').slice(0, 500), sendResponse: true }) });
          } else {
            await graph(token, path, { method: 'DELETE' });
          }
        } catch (e) {
          if (!(e instanceof HttpError) || !/not found/i.test(e.message)) throw e;
        }
        const m = await hubMeeting(b.id);
        if (m && m.status === 'scheduled') {
          await db.from('meetings').update({ status: 'cancelled' }).eq('id', m.id);
          await db.from('activities').insert({ contact_id: m.contact_id, kind: 'meeting', body: `Cancelled: ${m.subject}`, created_by: user.id });
        }
        return { ok: true };
      }

      case 'respond': {
        const path = eventPath(b.id);
        const action = ({ accept: 'accept', tentative: 'tentativelyAccept', decline: 'decline' } as Record<string, string>)[String(b.response)];
        if (!action) throw new HttpError(400, 'Accept, tentative or decline?');
        await graph(token, `${path}/${action}`, { method: 'POST', body: JSON.stringify({ comment: String(b.comment ?? '').slice(0, 500), sendResponse: true }) });
        return { ok: true };
      }

      default:
        throw new HttpError(400, 'Unknown action');
    }
  }),
);

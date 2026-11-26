// Creates an Outlook event from Hub (which sends the invitations) and records it on the contact.
// It goes in the mailbox of the contact's business: Real Estate and Staging have separate mailboxes.
import { businessOf, graph, graphToken, TIME_ZONE, torontoToUtc, wallTime } from '../_shared/microsoft.ts';
import { adminClient, HttpError, jsonHandler, requireUser } from '../_shared/supabase.ts';

const KINDS = { call: 'Call', meeting: 'Meeting', site_visit: 'Site visit' } as const;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

Deno.serve(
  jsonHandler(async (req) => {
    const user = await requireUser(req);
    const b = await req.json().catch(() => ({}));
    const kind = b.kind as keyof typeof KINDS;
    if (!(kind in KINDS)) throw new HttpError(400, 'Pick call, meeting or site visit');
    const start = wallTime(b.start, 'start');
    const end = wallTime(b.end, 'end');
    if (end <= start) throw new HttpError(400, 'The meeting must end after it starts');
    const subject = String(b.subject ?? '').trim().slice(0, 200);
    if (!subject) throw new HttpError(400, 'Add a title');

    const db = adminClient();
    const { data: contact } = await db.from('contacts').select('id, business, first_name, last_name, email, archived_at').eq('id', String(b.contactId)).maybeSingle();
    if (!contact || contact.archived_at) throw new HttpError(404, 'Contact not found');

    // Attendees: the contact (if invited and they have an email) plus chosen teammates.
    const attendees: { address: string; name: string }[] = [];
    if (b.inviteContact && contact.email) attendees.push({ address: contact.email, name: `${contact.first_name} ${contact.last_name}`.trim() });
    const teammateIds: string[] = Array.isArray(b.teammateIds) ? b.teammateIds.slice(0, 10) : [];
    if (teammateIds.length) {
      const { data: mates } = await db.from('profiles').select('id, email, display_name').in('id', teammateIds);
      for (const m of mates ?? []) if (m.id !== user.id) attendees.push({ address: m.email, name: m.display_name || m.email });
    }

    const notes = String(b.notes ?? '').trim().slice(0, 4000);
    const location = String(b.location ?? '').trim().slice(0, 300);
    const business = businessOf(contact.business);
    const token = await graphToken(user.id, business);
    const event = await graph<{ id: string; webLink: string; onlineMeeting?: { joinUrl?: string } | null }>(token, '/me/events', {
      method: 'POST',
      body: JSON.stringify({
        subject,
        body: { contentType: 'HTML', content: notes ? esc(notes).replace(/\n/g, '<br>') : '' },
        start: { dateTime: start, timeZone: TIME_ZONE },
        end: { dateTime: end, timeZone: TIME_ZONE },
        location: location ? { displayName: location } : undefined,
        attendees: attendees.map((a) => ({ emailAddress: a, type: 'required' })),
        isOnlineMeeting: !!b.teams,
        ...(b.teams && { onlineMeetingProvider: 'teamsForBusiness' }),
        allowNewTimeProposals: true,
        categories: ['Hub'],
      }),
    });

    const { data: meeting, error } = await db
      .from('meetings')
      .insert({
        contact_id: contact.id,
        organizer_id: user.id,
        outlook_event_id: event.id,
        mailbox_business: business,
        kind,
        subject,
        starts_at: torontoToUtc(start),
        ends_at: torontoToUtc(end),
        location,
        property_id: b.propertyId ? String(b.propertyId) : null,
        teams_url: event.onlineMeeting?.joinUrl ?? null,
        web_link: event.webLink,
        attendees: attendees.map((a) => a.address.toLowerCase()),
      })
      .select()
      .single();
    if (error) throw error;

    const when = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(meeting.starts_at));
    await db.from('activities').insert({
      contact_id: contact.id,
      kind: 'meeting',
      body: `Scheduled ${KINDS[kind].toLowerCase()} for ${when}${location ? ` at ${location}` : ''}: ${subject}`,
      created_by: user.id,
    });
    return { meeting };
  }),
);

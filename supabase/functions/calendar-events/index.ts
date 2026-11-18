// The signed-in user's Outlook events between two Toronto wall times (for the Dashboard).
import { graph, graphToken, tzHeader, wallTime } from '../_shared/microsoft.ts';
import { jsonHandler, requireUser } from '../_shared/supabase.ts';

interface GraphEvent {
  id: string;
  subject: string;
  start: { dateTime: string };
  end: { dateTime: string };
  isAllDay: boolean;
  isCancelled: boolean;
  showAs: string;
  location?: { displayName?: string };
  attendees?: { emailAddress: { address: string; name: string } }[];
  organizer?: { emailAddress: { address: string; name: string } };
  onlineMeeting?: { joinUrl?: string } | null;
  webLink: string;
}

Deno.serve(
  jsonHandler(async (req) => {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const start = wallTime(body.start, 'start');
    const end = wallTime(body.end, 'end');
    const token = await graphToken(user.id);
    const select = 'subject,start,end,isAllDay,isCancelled,showAs,location,attendees,organizer,onlineMeeting,webLink';
    const res = await graph<{ value: GraphEvent[] }>(
      token,
      `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$select=${select}&$orderby=start/dateTime&$top=100`,
      { headers: tzHeader },
    );
    return {
      events: res.value
        .filter((e) => !e.isCancelled)
        .map((e) => ({
          id: e.id,
          subject: e.subject || '(No subject)',
          start: e.start.dateTime.slice(0, 16),
          end: e.end.dateTime.slice(0, 16),
          allDay: e.isAllDay,
          showAs: e.showAs,
          location: e.location?.displayName ?? '',
          // Everyone on the invite, so Hub can match them to contacts.
          emails: [...(e.attendees ?? []).map((a) => a.emailAddress.address), e.organizer?.emailAddress.address ?? '']
            .filter(Boolean)
            .map((a) => a.toLowerCase()),
          joinUrl: e.onlineMeeting?.joinUrl ?? null,
          webLink: e.webLink,
        })),
    };
  }),
);

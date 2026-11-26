// The signed-in user's Outlook events between two Toronto wall times (Dashboard agenda and the Calendar page),
// from the mailbox of the business they're working in.
import { businessOf, graph, graphToken, tzHeader, wallTime } from '../_shared/microsoft.ts';
import { HttpError, jsonHandler, requireUser } from '../_shared/supabase.ts';

interface GraphPerson {
  emailAddress: { address: string; name: string };
}
interface GraphEvent {
  id: string;
  subject: string;
  start: { dateTime: string };
  end: { dateTime: string };
  isAllDay: boolean;
  isCancelled: boolean;
  isOrganizer: boolean;
  showAs: string;
  type: string;
  categories?: string[];
  bodyPreview?: string;
  responseStatus?: { response: string };
  location?: { displayName?: string };
  attendees?: (GraphPerson & { status?: { response: string } })[];
  organizer?: GraphPerson;
  onlineMeeting?: { joinUrl?: string } | null;
  webLink: string;
}

const MAX_EVENTS = 600;

Deno.serve(
  jsonHandler(async (req) => {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const start = wallTime(body.start, 'start');
    const end = wallTime(body.end, 'end');
    if (end <= start) throw new HttpError(400, 'The range must end after it starts');
    // A month view plus a little either side is the most anyone asks for.
    if (Date.parse(end) - Date.parse(start) > 50 * 24 * 3600 * 1000) throw new HttpError(400, 'Ask for at most 50 days at a time');

    const token = await graphToken(user.id, businessOf(body.business));
    const select = 'subject,start,end,isAllDay,isCancelled,isOrganizer,showAs,type,categories,bodyPreview,responseStatus,location,attendees,organizer,onlineMeeting,webLink';
    const all: GraphEvent[] = [];
    let path: string | null = `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$select=${select}&$orderby=start/dateTime&$top=200`;
    // Graph pages long ranges; follow the pages (it hands back a full URL).
    while (path && all.length < MAX_EVENTS) {
      const res: { value: GraphEvent[]; '@odata.nextLink'?: string } = await graph(token, path, { headers: tzHeader });
      all.push(...res.value);
      const next = res['@odata.nextLink'];
      path = next ? next.replace('https://graph.microsoft.com/v1.0', '') : null;
    }

    return {
      events: all
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
          // For the Calendar page.
          isOrganizer: e.isOrganizer,
          organizer: e.organizer ? { name: e.organizer.emailAddress.name, email: e.organizer.emailAddress.address.toLowerCase() } : null,
          attendees: (e.attendees ?? []).map((a) => ({
            name: a.emailAddress.name,
            email: a.emailAddress.address.toLowerCase(),
            response: a.status?.response ?? 'none',
          })),
          myResponse: e.responseStatus?.response ?? 'none',
          recurring: e.type === 'occurrence' || e.type === 'exception',
          categories: e.categories ?? [],
          preview: (e.bodyPreview ?? '').slice(0, 500),
        })),
      truncated: all.length >= MAX_EVENTS,
    };
  }),
);

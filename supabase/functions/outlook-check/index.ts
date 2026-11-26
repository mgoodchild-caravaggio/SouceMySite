// Confirms the signed-in user's Outlook connection works: reads their mailbox name and next meeting.
import { businessOf, graph, graphToken } from '../_shared/microsoft.ts';
import { jsonHandler, requireUser } from '../_shared/supabase.ts';

Deno.serve(
  jsonHandler(async (req) => {
    const user = await requireUser(req);
    const { business } = await req.json().catch(() => ({}));
    const token = await graphToken(user.id, businessOf(business));
    const now = new Date();
    const week = new Date(now.getTime() + 7 * 86_400_000);
    const [me, events] = await Promise.all([
      graph<{ displayName: string; mail?: string; userPrincipalName: string }>(token, '/me?$select=displayName,mail,userPrincipalName'),
      graph<{ value: { subject: string; start: { dateTime: string; timeZone: string } }[] }>(
        token,
        `/me/calendarView?startDateTime=${now.toISOString()}&endDateTime=${week.toISOString()}&$select=subject,start&$orderby=start/dateTime&$top=1`,
        { headers: { Prefer: 'outlook.timezone="America/Toronto"' } },
      ),
    ]);
    return {
      mailbox: me.mail ?? me.userPrincipalName,
      name: me.displayName,
      nextMeeting: events.value[0] ? { subject: events.value[0].subject, start: events.value[0].start.dateTime } : null,
    };
  }),
);

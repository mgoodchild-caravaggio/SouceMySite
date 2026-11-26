// Busy times for the signed-in user and chosen teammates on one day (Outlook free/busy only, no details).
import { businessOf, graph, graphToken, tzHeader, TIME_ZONE, wallTime } from '../_shared/microsoft.ts';
import { HttpError, jsonHandler, requireUser } from '../_shared/supabase.ts';

Deno.serve(
  jsonHandler(async (req) => {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const start = wallTime(body.start, 'start');
    const end = wallTime(body.end, 'end');
    const emails: string[] = Array.isArray(body.emails) ? body.emails.filter((e: unknown) => typeof e === 'string').slice(0, 10) : [];
    if (!emails.length) throw new HttpError(400, 'No calendars to check');
    const token = await graphToken(user.id, businessOf(body.business));
    const res = await graph<{ value: { scheduleId: string; error?: { message: string }; scheduleItems?: { status: string; start: { dateTime: string }; end: { dateTime: string } }[] }[] }>(
      token,
      '/me/calendar/getSchedule',
      {
        method: 'POST',
        headers: tzHeader,
        body: JSON.stringify({
          schedules: emails,
          startTime: { dateTime: start, timeZone: TIME_ZONE },
          endTime: { dateTime: end, timeZone: TIME_ZONE },
          availabilityViewInterval: 15,
        }),
      },
    );
    return {
      people: res.value.map((s) => ({
        email: s.scheduleId.toLowerCase(),
        error: s.error?.message ?? null,
        busy: (s.scheduleItems ?? [])
          .filter((i) => i.status !== 'free')
          .map((i) => ({ start: i.start.dateTime.slice(0, 16), end: i.end.dateTime.slice(0, 16), status: i.status })),
      })),
    };
  }),
);
